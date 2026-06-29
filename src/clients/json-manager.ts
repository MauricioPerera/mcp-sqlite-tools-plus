/**
 * JSON import/export functionality for SQLite Tools MCP server
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { with_error_handling } from '../common/errors.js';
import { debug_log } from '../config.js';
import { resolve_csv_path, validate_headers } from './csv-manager.js';
import {
	ExportSource,
	ImportInsertOptions,
	ImportOutcome,
	ImportRowError,
	ImportResultInput,
	build_import_result,
	ensure_import_table,
	prepare_rows,
	read_export_source,
	run_import_inserts,
} from './table-io-shared.js';

export interface JsonImportOptions {
	create_table?: boolean;
	batch_size?: number;
	fail_fast?: boolean;
	max_errors?: number;
}

export interface JsonExportOptions {
	encoding?: BufferEncoding;
	append?: boolean;
}

export interface JsonImportResult {
	file_path: string;
	table: string;
	created_table: boolean;
	columns: string[];
	rows_read: number;
	inserted: number;
	failed: number;
	errors: ImportRowError[];
	errors_truncated: boolean;
	total_time: number;
}

export interface JsonExportResult {
	file_path: string;
	query: string;
	columns: string[];
	rows_exported: number;
	bytes_written: number;
	total_time: number;
}

function parse_json_file(file_path: string): Record<string, unknown>[] {
	const parsed: unknown = JSON.parse(readFileSync(file_path, 'utf8'));
	if (!Array.isArray(parsed)) {
		throw new Error('JSON file must contain an array of objects');
	}
	return parsed as Record<string, unknown>[];
}

function extract_headers(records: Record<string, unknown>[]): string[] {
	const headers: string[] = [];
	const seen = new Set<string>();
	for (const record of records) {
		for (const key of Object.keys(record)) {
			if (!seen.has(key)) {
				seen.add(key);
				headers.push(key);
			}
		}
	}
	return headers;
}

function to_object_rows(
	columns: string[],
	rows: unknown[][],
): Record<string, unknown>[] {
	return rows.map((row) => {
		const object: Record<string, unknown> = {};
		columns.forEach((column, index) => {
			object[column] = row[index];
		});
		return object;
	});
}

function build_json_payload(
	file_path: string,
	objects: Record<string, unknown>[],
	append: boolean,
): string {
	let payload = objects;
	if (append && existsSync(file_path)) {
		payload = [...parse_json_file(file_path), ...objects];
	}
	return JSON.stringify(payload, null, 2);
}

function import_options(options: JsonImportOptions): ImportInsertOptions {
	return {
		batch_size: options.batch_size ?? 1000,
		fail_fast: options.fail_fast ?? false,
		max_errors: options.max_errors ?? 100,
	};
}

function load_json_records(
	file_path: string,
): {
	file_path: string;
	headers: string[];
	rows: Array<Record<string, unknown>>;
} {
	const resolved_file_path = resolve_csv_path(file_path);
	if (!existsSync(resolved_file_path)) {
		throw new Error(`JSON file does not exist: ${resolved_file_path}`);
	}

	const records = parse_json_file(resolved_file_path);
	const headers = extract_headers(records);
	validate_headers(headers);
	return {
		file_path: resolved_file_path,
		headers,
		rows: prepare_rows(records, headers),
	};
}

function perform_json_import(
	database_path: string,
	table: string,
	file_path: string,
	options: JsonImportOptions,
): JsonImportResult {
	const start_time = Date.now();
	const { file_path: resolved_file_path, headers, rows } =
		load_json_records(file_path);
	const created_table = ensure_import_table(
		database_path,
		table,
		headers,
		rows,
		options.create_table ?? true,
	);
	const outcome: ImportOutcome = run_import_inserts(
		database_path,
		table,
		headers,
		rows,
		import_options(options),
	);
	const input: ImportResultInput = {
		file_path: resolved_file_path,
		table,
		created_table,
		headers,
		rows,
		outcome,
		start_time,
	};
	debug_log('JSON import completed:', input);
	return build_import_result(input) as JsonImportResult;
}

/**
 * Import a JSON file (array of objects) into a SQLite table.
 */
export async function import_json(
	database_path: string,
	table: string,
	file_path: string,
	options: JsonImportOptions = {},
): Promise<JsonImportResult> {
	return with_error_handling(
		async () => perform_json_import(database_path, table, file_path, options),
		'import_json',
	)();
}

function perform_json_export(
	database_path: string,
	file_path: string,
	input: { table?: string; query?: string },
	options: JsonExportOptions,
): JsonExportResult {
	const start_time = Date.now();
	const resolved_file_path = resolve_csv_path(file_path);
	const source: ExportSource = read_export_source(database_path, input);
	const objects = to_object_rows(source.columns, source.rows);

	const output_dir = dirname(resolved_file_path);
	if (!existsSync(output_dir)) {
		mkdirSync(output_dir, { recursive: true });
	}

	const json_text = build_json_payload(
		resolved_file_path,
		objects,
		options.append ?? false,
	);
	writeFileSync(resolved_file_path, json_text, {
		encoding: options.encoding ?? 'utf8',
	});

	const bytes_written = existsSync(resolved_file_path)
		? statSync(resolved_file_path).size
		: 0;
	const result: JsonExportResult = {
		file_path: resolved_file_path,
		query: source.query,
		columns: source.columns,
		rows_exported: source.rows.length,
		bytes_written,
		total_time: Date.now() - start_time,
	};
	debug_log('JSON export completed:', result);
	return result;
}

/**
 * Export a SQLite table or read-only query to a JSON file (array of objects).
 */
export async function export_json(
	database_path: string,
	file_path: string,
	input: { table?: string; query?: string },
	options: JsonExportOptions = {},
): Promise<JsonExportResult> {
	return with_error_handling(
		async () => perform_json_export(database_path, file_path, input, options),
		'export_json',
	)();
}