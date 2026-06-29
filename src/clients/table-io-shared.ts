/**
 * Shared helpers for tabular import/export (JSON, XLSX).
 *
 * Mirrors the CSV manager's approach: small, single-purpose helpers that
 * stay within the complexity budget. Reuses type inference, identifier
 * quoting and table introspection from csv-manager to avoid duplication.
 */
import { quote_identifier } from '../common/sql.js';
import { open_database } from './connection-manager.js';
import {
	create_table_from_csv,
	get_table_columns,
	row_error_message,
	table_exists,
	validate_import_columns,
} from './csv-manager.js';
import { has_active_transaction } from './transaction-manager.js';

export interface ExportSource {
	query: string;
	columns: string[];
	rows: unknown[][];
}

export interface ImportInsertOptions {
	batch_size: number;
	fail_fast: boolean;
	max_errors: number;
}

export interface ImportRowError {
	row: number;
	error: string;
	data: Record<string, unknown>;
}

export interface ImportOutcome {
	inserted: number;
	failed: number;
	errors: ImportRowError[];
	errors_truncated: boolean;
}

interface ImportState {
	inserted: number;
	failed: number;
	errors: ImportRowError[];
	errors_truncated: boolean;
}

/**
 * Read a table or read-only query into raw column arrays for export.
 * Exactly one of table/query must be provided; the query must be read-only.
 */
export function read_export_source(
	database_path: string,
	input: { table?: string; query?: string },
): ExportSource {
	if ((input.table && input.query) || (!input.table && !input.query)) {
		throw new Error('Provide exactly one of table or query for export');
	}

	const query = input.table
		? `SELECT * FROM ${quote_identifier(input.table)}`
		: input.query!;
	const db = open_database(database_path);
	const stmt = db.prepare(query);

	if (!stmt.readonly) {
		throw new Error('Export query must be read-only');
	}

	const columns = stmt.columns().map((column) => column.name);
	const rows = stmt.raw(true).all() as unknown[][];
	return { query, columns, rows };
}

/**
 * Ensure the target table exists for an import, creating it from headers
 * and sample rows when missing. Returns true when the table was created.
 */
export function ensure_import_table(
	database_path: string,
	table: string,
	headers: string[],
	rows: Array<Record<string, unknown>>,
	create_table: boolean,
): boolean {
	if (table_exists(database_path, table)) {
		validate_import_columns(
			headers,
			get_table_columns(database_path, table),
		);
		return false;
	}

	if (!create_table) {
		throw new Error(`Target table does not exist: ${table}`);
	}

	create_table_from_csv(database_path, table, headers, rows);
	return true;
}

/** Coerce a single typed value into a SQLite-storable value. */
export function coerce_import_value(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

/** Project records onto the given headers, coercing each value. */
export function prepare_rows(
	records: Record<string, unknown>[],
	headers: string[],
): Array<Record<string, unknown>> {
	return records.map((record) => {
		const row: Record<string, unknown> = {};
		for (const header of headers) {
			row[header] = coerce_import_value(record[header]);
		}
		return row;
	});
}

export interface ImportResultInput {
	file_path: string;
	table: string;
	created_table: boolean;
	headers: string[];
	rows: Array<Record<string, unknown>>;
	outcome: ImportOutcome;
	start_time: number;
}

/** Build the common import result shape shared by JSON and XLSX imports. */
export function build_import_result(input: ImportResultInput) {
	return {
		file_path: input.file_path,
		table: input.table,
		created_table: input.created_table,
		columns: input.headers,
		rows_read: input.rows.length,
		inserted: input.outcome.inserted,
		failed: input.outcome.failed,
		errors: input.outcome.errors,
		errors_truncated: input.outcome.errors_truncated,
		total_time: Date.now() - input.start_time,
	};
}

function prepare_insert_stmt(
	database_path: string,
	table: string,
	headers: string[],
) {
	const db = open_database(database_path);
	const placeholders = headers.map(() => '?').join(', ');
	const column_list = headers.map(quote_identifier).join(', ');
	const insert_sql = `INSERT INTO ${quote_identifier(table)} (${column_list}) VALUES (${placeholders})`;
	return db.prepare(insert_sql);
}

function record_row_error(
	state: ImportState,
	row: number,
	error: unknown,
	data: Record<string, unknown>,
	max_errors: number,
): void {
	if (state.errors.length < max_errors) {
		state.errors.push({ row, error: row_error_message(error), data });
	} else {
		state.errors_truncated = true;
	}
}

interface InsertRun {
	stmt: ReturnType<ReturnType<typeof open_database>['prepare']>;
	headers: string[];
	options: ImportInsertOptions;
	state: ImportState;
}

function process_insert_row(
	run: InsertRun,
	row: Record<string, unknown>,
	row_index: number,
): void {
	const values = run.headers.map((header) => row[header]);
	try {
		const result = run.stmt.run(values);
		if (result.changes > 0) run.state.inserted++;
	} catch (error) {
		run.state.failed++;
		record_row_error(
			run.state,
			row_index + 1,
			error,
			row,
			run.options.max_errors,
		);
		if (run.options.fail_fast) throw error;
	}
}

function execute_insert_batches(
	run: InsertRun,
	rows: Array<Record<string, unknown>>,
): void {
	for (let i = 0; i < rows.length; i += run.options.batch_size) {
		const batch = rows.slice(i, i + run.options.batch_size);
		for (let batch_index = 0; batch_index < batch.length; batch_index++) {
			process_insert_row(run, batch[batch_index], i + batch_index);
		}
	}
}

/**
 * Run a batched, transactional insert of prepared rows with per-row error
 * reporting. Mirrors import_csv's insert loop without duplicating its body.
 */
export function run_import_inserts(
	database_path: string,
	table: string,
	headers: string[],
	rows: Array<Record<string, unknown>>,
	options: ImportInsertOptions,
): ImportOutcome {
	const db = open_database(database_path);
	const stmt = prepare_insert_stmt(database_path, table, headers);
	const state: ImportState = {
		inserted: 0,
		failed: 0,
		errors: [],
		errors_truncated: false,
	};
	const run: InsertRun = { stmt, headers, options, state };

	const use_transaction = !has_active_transaction(database_path);
	if (use_transaction) db.exec('BEGIN');

	try {
		execute_insert_batches(run, rows);
		if (use_transaction) db.exec('COMMIT');
	} catch (error) {
		if (use_transaction) db.exec('ROLLBACK');
		throw error;
	}

	return {
		inserted: state.inserted,
		failed: state.failed,
		errors: state.errors,
		errors_truncated: state.errors_truncated,
	};
}