/**
 * XLSX import/export functionality for SQLite Tools MCP server
 */
import exceljs from 'exceljs';
import type { Worksheet } from 'exceljs';

const { Workbook } = exceljs;
import { existsSync, mkdirSync, statSync } from 'node:fs';
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

export interface XlsxImportOptions {
	create_table?: boolean;
	batch_size?: number;
	fail_fast?: boolean;
	max_errors?: number;
}

export interface XlsxExportOptions {
	sheet_name?: string;
}

export interface XlsxImportResult {
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

export interface XlsxExportResult {
	file_path: string;
	query: string;
	sheet_name: string;
	columns: string[];
	rows_exported: number;
	bytes_written: number;
	total_time: number;
}

interface ParsedXlsx {
	headers: string[];
	records: Record<string, unknown>[];
}

function is_empty_cell(value: unknown): boolean {
	return value === null || value === undefined || value === '';
}

function read_xlsx_records(
	worksheet: Worksheet,
	headers: string[],
): Record<string, unknown>[] {
	const records: Record<string, unknown>[] = [];
	for (let row_number = 2; row_number <= worksheet.rowCount; row_number++) {
		const values = (worksheet.getRow(row_number).values as unknown[]).slice(1);
		if (values.every(is_empty_cell)) continue;
		const record: Record<string, unknown> = {};
		headers.forEach((header, index) => {
			record[header] = values[index];
		});
		records.push(record);
	}
	return records;
}

async function parse_xlsx_file(file_path: string): Promise<ParsedXlsx> {
	const workbook = new Workbook();
	await workbook.xlsx.readFile(file_path);
	const worksheet = workbook.worksheets[0];
	if (!worksheet) {
		throw new Error('XLSX file must contain at least one sheet');
	}

	const header_values = (worksheet.getRow(1).values as unknown[]).slice(1);
	const headers = header_values.map((value) => String(value ?? ''));
	const records = read_xlsx_records(worksheet, headers);
	return { headers, records };
}

function import_options(options: XlsxImportOptions): ImportInsertOptions {
	return {
		batch_size: options.batch_size ?? 1000,
		fail_fast: options.fail_fast ?? false,
		max_errors: options.max_errors ?? 100,
	};
}

async function load_xlsx_records(
	file_path: string,
): Promise<{
	file_path: string;
	headers: string[];
	rows: Array<Record<string, unknown>>;
}> {
	const resolved_file_path = resolve_csv_path(file_path);
	if (!existsSync(resolved_file_path)) {
		throw new Error(`XLSX file does not exist: ${resolved_file_path}`);
	}

	const parsed = await parse_xlsx_file(resolved_file_path);
	validate_headers(parsed.headers);
	return {
		file_path: resolved_file_path,
		headers: parsed.headers,
		rows: prepare_rows(parsed.records, parsed.headers),
	};
}

async function perform_xlsx_import(
	database_path: string,
	table: string,
	file_path: string,
	options: XlsxImportOptions,
): Promise<XlsxImportResult> {
	const start_time = Date.now();
	const { file_path: resolved_file_path, headers, rows } =
		await load_xlsx_records(file_path);
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
	debug_log('XLSX import completed:', input);
	return build_import_result(input) as XlsxImportResult;
}

/**
 * Import the first sheet of an XLSX file (first row = headers) into SQLite.
 */
export async function import_xlsx(
	database_path: string,
	table: string,
	file_path: string,
	options: XlsxImportOptions = {},
): Promise<XlsxImportResult> {
	return with_error_handling(
		async () => perform_xlsx_import(database_path, table, file_path, options),
		'import_xlsx',
	)();
}

function write_xlsx_file(
	file_path: string,
	sheet_name: string,
	columns: string[],
	rows: unknown[][],
): Promise<unknown> {
	const workbook = new Workbook();
	const worksheet = workbook.addWorksheet(sheet_name);
	worksheet.addRow(columns);
	for (const row of rows) worksheet.addRow(row);
	return workbook.xlsx.writeFile(file_path);
}

async function perform_xlsx_export(
	database_path: string,
	file_path: string,
	input: { table?: string; query?: string },
	options: XlsxExportOptions,
): Promise<XlsxExportResult> {
	const start_time = Date.now();
	const resolved_file_path = resolve_csv_path(file_path);
	const source: ExportSource = read_export_source(database_path, input);
	const sheet_name = options.sheet_name ?? 'Sheet1';

	const output_dir = dirname(resolved_file_path);
	if (!existsSync(output_dir)) {
		mkdirSync(output_dir, { recursive: true });
	}

	await write_xlsx_file(
		resolved_file_path,
		sheet_name,
		source.columns,
		source.rows,
	);

	const bytes_written = existsSync(resolved_file_path)
		? statSync(resolved_file_path).size
		: 0;
	const result: XlsxExportResult = {
		file_path: resolved_file_path,
		query: source.query,
		sheet_name,
		columns: source.columns,
		rows_exported: source.rows.length,
		bytes_written,
		total_time: Date.now() - start_time,
	};
	debug_log('XLSX export completed:', result);
	return result;
}

/**
 * Export a SQLite table or read-only query to an XLSX file (one sheet).
 */
export async function export_xlsx(
	database_path: string,
	file_path: string,
	input: { table?: string; query?: string },
	options: XlsxExportOptions = {},
): Promise<XlsxExportResult> {
	return with_error_handling(
		async () => perform_xlsx_export(database_path, file_path, input, options),
		'export_xlsx',
	)();
}