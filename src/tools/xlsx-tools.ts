/**
 * XLSX import/export tools for the SQLite Tools MCP server
 */
import { McpServer } from 'tmcp';
import * as v from 'valibot';
import * as sqlite from '../clients/sqlite.js';
import {
	ToolUsageError,
	create_tool_error_response,
	create_tool_response,
} from '../common/errors.js';
import { debug_log } from '../config.js';
import {
	resolve_database_name,
	set_current_database,
} from './context.js';

const ImportXlsxSchema = v.object({
	table: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	file_path: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
	database_name: v.optional(v.pipe(v.string(), v.maxLength(255))),
	create_table: v.optional(v.boolean(), true),
	batch_size: v.optional(
		v.pipe(v.number(), v.minValue(1), v.maxValue(10000)),
		1000,
	),
	fail_fast: v.optional(v.boolean(), false),
	max_errors: v.optional(
		v.pipe(v.number(), v.minValue(0), v.maxValue(10000)),
		100,
	),
	sheet_name: v.optional(v.pipe(v.string(), v.maxLength(31))),
});

const ExportXlsxSchema = v.object({
	file_path: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
	table: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
	query: v.optional(
		v.pipe(v.string(), v.minLength(1), v.maxLength(10000)),
	),
	database_name: v.optional(v.pipe(v.string(), v.maxLength(255))),
	sheet_name: v.optional(v.pipe(v.string(), v.maxLength(31)), 'Sheet1'),
});

type ImportXlsxArgs = v.InferInput<typeof ImportXlsxSchema>;
type ExportXlsxArgs = v.InferInput<typeof ExportXlsxSchema>;

function setup_database_context(database_name?: string) {
	const database_path = resolve_database_name(database_name);
	if (database_name) set_current_database(database_name);
	return database_path;
}

async function handle_import_xlsx({
	table,
	file_path,
	database_name,
	create_table = true,
	batch_size = 1000,
	fail_fast = false,
	max_errors = 100,
}: ImportXlsxArgs) {
	try {
		debug_log('Executing tool: import_xlsx', {
			table,
			file_path,
			database_name,
			create_table,
			batch_size,
			fail_fast,
			max_errors,
		});

		const database_path = setup_database_context(database_name);
		const result = await sqlite.import_xlsx(
			database_path,
			table,
			file_path,
			{ create_table, batch_size, fail_fast, max_errors },
		);

		return create_tool_response({
			success: result.failed === 0,
			database: database_path,
			...result,
			message: `⚠️ XLSX IMPORT COMPLETED: ${result.inserted} rows inserted into '${table}' from '${result.file_path}'. Failed rows: ${result.failed}`,
		});
	} catch (error) {
		return create_tool_error_response(error);
	}
}

async function handle_export_xlsx({
	file_path,
	table,
	query,
	database_name,
	sheet_name = 'Sheet1',
}: ExportXlsxArgs) {
	try {
		debug_log('Executing tool: export_xlsx', {
			file_path, table, query, database_name, sheet_name,
		});

		if ((table && query) || (!table && !query)) {
			throw new ToolUsageError(
				'Provide exactly one of table or query for XLSX export',
				['Use table to export a full table', 'Use query to export filtered/projected read-only results'],
			);
		}

		const database_path = setup_database_context(database_name);
		const result = await sqlite.export_xlsx(
			database_path,
			file_path,
			{ table, query },
			{ sheet_name },
		);

		return create_tool_response({
			success: true,
			database: database_path,
			...result,
			message: `XLSX EXPORT COMPLETED: ${result.rows_exported} rows exported to '${result.file_path}'`,
		});
	} catch (error) {
		return create_tool_error_response(error);
	}
}

/**
 * Register XLSX tools with the server
 */
export function register_xlsx_tools(server: McpServer<any>): void {
	server.tool<typeof ImportXlsxSchema>(
		{
			name: 'import_xlsx',
			description:
				'⚠️ DESTRUCTIVE/SCHEMA CHANGE: Import the first sheet of an XLSX file (first row = headers) into SQLite. Creates the table from headers when missing and reports row-level errors.',
			schema: ImportXlsxSchema,
		},
		async (args) => handle_import_xlsx(args),
	);

	server.tool<typeof ExportXlsxSchema>(
		{
			name: 'export_xlsx',
			description:
				'⚠️ FILE WRITE: Export a table or read-only SELECT/PRAGMA/EXPLAIN query to an XLSX file (one sheet, first row = headers). Can write absolute paths. Provide exactly one of table or query.',
			schema: ExportXlsxSchema,
		},
		async (args) => handle_export_xlsx(args),
	);
}