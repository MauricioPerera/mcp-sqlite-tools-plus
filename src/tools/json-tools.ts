/**
 * JSON import/export tools for the SQLite Tools MCP server
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

const BufferEncodingSchema = v.union([
	v.literal('ascii'),
	v.literal('utf8'),
	v.literal('utf-8'),
	v.literal('utf16le'),
	v.literal('ucs2'),
	v.literal('ucs-2'),
	v.literal('base64'),
	v.literal('base64url'),
	v.literal('latin1'),
	v.literal('binary'),
	v.literal('hex'),
]);

const ImportJsonSchema = v.object({
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
});

const ExportJsonSchema = v.object({
	file_path: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
	table: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
	query: v.optional(
		v.pipe(v.string(), v.minLength(1), v.maxLength(10000)),
	),
	database_name: v.optional(v.pipe(v.string(), v.maxLength(255))),
	encoding: v.optional(BufferEncodingSchema, 'utf8'),
	append: v.optional(v.boolean(), false),
});

type ImportJsonArgs = v.InferInput<typeof ImportJsonSchema>;
type ExportJsonArgs = v.InferInput<typeof ExportJsonSchema>;

function setup_database_context(database_name?: string) {
	const database_path = resolve_database_name(database_name);
	if (database_name) set_current_database(database_name);
	return database_path;
}

async function handle_import_json({
	table,
	file_path,
	database_name,
	create_table = true,
	batch_size = 1000,
	fail_fast = false,
	max_errors = 100,
}: ImportJsonArgs) {
	try {
		debug_log('Executing tool: import_json', {
			table,
			file_path,
			database_name,
			create_table,
			batch_size,
			fail_fast,
			max_errors,
		});

		const database_path = setup_database_context(database_name);
		const result = await sqlite.import_json(
			database_path,
			table,
			file_path,
			{ create_table, batch_size, fail_fast, max_errors },
		);

		return create_tool_response({
			success: result.failed === 0,
			database: database_path,
			...result,
			message: `⚠️ JSON IMPORT COMPLETED: ${result.inserted} rows inserted into '${table}' from '${result.file_path}'. Failed rows: ${result.failed}`,
		});
	} catch (error) {
		return create_tool_error_response(error);
	}
}

async function handle_export_json({
	file_path,
	table,
	query,
	database_name,
	encoding = 'utf8',
	append = false,
}: ExportJsonArgs) {
	try {
		debug_log('Executing tool: export_json', {
			file_path, table, query, database_name, encoding, append,
		});

		if ((table && query) || (!table && !query)) {
			throw new ToolUsageError(
				'Provide exactly one of table or query for JSON export',
				['Use table to export a full table', 'Use query to export filtered/projected read-only results'],
			);
		}

		const database_path = setup_database_context(database_name);
		const result = await sqlite.export_json(
			database_path,
			file_path,
			{ table, query },
			{ encoding, append },
		);

		return create_tool_response({
			success: true,
			database: database_path,
			...result,
			message: `JSON EXPORT COMPLETED: ${result.rows_exported} rows exported to '${result.file_path}'`,
		});
	} catch (error) {
		return create_tool_error_response(error);
	}
}

/**
 * Register JSON tools with the server
 */
export function register_json_tools(server: McpServer<any>): void {
	server.tool<typeof ImportJsonSchema>(
		{
			name: 'import_json',
			description:
				'⚠️ DESTRUCTIVE/SCHEMA CHANGE: Import a JSON file (array of objects) into SQLite. Creates the table from object keys when missing and reports row-level errors.',
			schema: ImportJsonSchema,
		},
		async (args) => handle_import_json(args),
	);

	server.tool<typeof ExportJsonSchema>(
		{
			name: 'export_json',
			description:
				'⚠️ FILE WRITE: Export a table or read-only SELECT/PRAGMA/EXPLAIN query to a JSON file (array of objects). Can write absolute paths. Provide exactly one of table or query.',
			schema: ExportJsonSchema,
		},
		async (args) => handle_export_json(args),
	);
}