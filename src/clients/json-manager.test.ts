import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
	close_all_databases,
	open_database,
	stop_connection_maintenance,
} from './connection-manager.js';
import { export_json, import_json } from './json-manager.js';
import {
	execute_query,
	execute_select_query,
} from './query-executor.js';

const temp_dirs: string[] = [];

function temp_db(name = 'test.sqlite') {
	const dir = mkdtempSync(join(tmpdir(), 'mcp-sqlite-tools-'));
	temp_dirs.push(dir);
	const db_path = join(dir, name);
	open_database(db_path, true);
	return db_path;
}

afterAll(() => {
	close_all_databases();
	stop_connection_maintenance();
	for (const dir of temp_dirs)
		rmSync(dir, { recursive: true, force: true });
});

function expect_rows(db_path: string, sql: string, expected: unknown[]) {
	expect(execute_select_query(db_path, sql).rows).toEqual(expected);
}

describe('JSON manager', () => {
	it('round-trips JSON export and import into a new table', async () => {
		const db_path = temp_db();
		execute_query(db_path, 'CREATE TABLE people (name TEXT, age INTEGER, active INTEGER, score REAL)');
		execute_query(db_path, "INSERT INTO people (name, age, active, score) VALUES ('Ada', 42, 1, 3.5), ('Bob', 7, 0, 2.25)");
		const json_path = join(dirname(db_path), 'people.json');

		const export_result = await export_json(db_path, json_path, { table: 'people' });
		expect(export_result.rows_exported).toBe(2);
		expect(export_result.columns).toEqual(['name', 'age', 'active', 'score']);

		const import_result = await import_json(db_path, 'people_copy', json_path);
		expect(import_result).toMatchObject({ created_table: true, rows_read: 2, inserted: 2, failed: 0 });

		expect_rows(db_path, 'SELECT name, age, active, score FROM people_copy ORDER BY name', [
			{ name: 'Ada', age: 42, active: 1, score: 3.5 },
			{ name: 'Bob', age: 7, active: 0, score: 2.25 },
		]);
	});

	it('exports read-only queries to JSON and writes objects', async () => {
		const db_path = temp_db();
		execute_query(db_path, 'CREATE TABLE items (id INTEGER, name TEXT)');
		execute_query(
			db_path,
			"INSERT INTO items (id, name) VALUES (1, 'Ada'), (2, 'Bob')",
		);
		const json_path = join(dirname(db_path), 'query-export.json');

		const result = await export_json(db_path, json_path, {
			query: 'SELECT name FROM items WHERE id = 2',
		});

		expect(result.rows_exported).toBe(1);
		expect(JSON.parse(readFileSync(json_path, 'utf8'))).toEqual([
			{ name: 'Bob' },
		]);
	});

	it('rejects non-read-only queries for JSON export', async () => {
		const db_path = temp_db();
		execute_query(db_path, 'CREATE TABLE t (id INTEGER)');
		const json_path = join(dirname(db_path), 'write.json');

		await expect(
			export_json(db_path, json_path, {
				query: 'INSERT INTO t (id) VALUES (1)',
			}),
		).rejects.toThrow(/read-only/);
	});

	it('rejects a missing JSON file for import', async () => {
		const db_path = temp_db();
		await expect(
			import_json(
				db_path,
				't',
				join(dirname(db_path), 'nope.json'),
			),
		).rejects.toThrow(/does not exist/);
	});

	it('reports JSON row import errors and continues', async () => {
		const db_path = temp_db();
		execute_query(
			db_path,
			'CREATE TABLE constrained (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
		);
		const json_path = join(dirname(db_path), 'constrained.json');
		writeFileSync(
			json_path,
			JSON.stringify([
				{ id: 1, name: 'Ada' },
				{ id: 1, name: 'Bob' },
				{ id: 2, name: null },
			]),
		);

		const result = await import_json(db_path, 'constrained', json_path);
		expect(result.inserted).toBe(1);
		expect(result.failed).toBe(2);
		expect(result.errors.map((error) => error.row)).toEqual([2, 3]);
		expect(
			execute_select_query(
				db_path,
				'SELECT id, name FROM constrained ORDER BY id',
			).rows,
		).toEqual([{ id: 1, name: 'Ada' }]);
	});
});