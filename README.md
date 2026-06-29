# mcp-sqlite-tools-plus

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives
AI agents safe, structured access to **local SQLite databases**: full CRUD, schema
introspection, table relations (foreign keys), generated/computed columns, and
**multi-format import/export — CSV, JSON and XLSX**.

> **Fork notice.** This is a fork of
> [`spences10/mcp-sqlite-tools`](https://github.com/spences10/mcp-sqlite-tools) by
> Scott Spence (MIT). It adds JSON and XLSX import/export tools on top of the
> original CSV support, plus hardening guidance. All original tooling and credit
> belong to the upstream project. The complete per-tool reference from upstream is
> preserved in [`docs/UPSTREAM_README.md`](docs/UPSTREAM_README.md).

---

## Why this exists

For a non-technical user who only talks to an agent, the agent can do everything a
spreadsheet does — and more — by talking to this server: read, create, update and
delete rows, relate tables, compute totals automatically, and hand back a CSV / JSON
/ Excel file to share. The deterministic work (queries, format conversion) is done
by the server, not improvised by the model.

## Features

- **CRUD** over any SQLite database via SQL or dedicated tools.
- **Schema introspection** — `list_tables`, `describe_table`, `export_schema`.
- **Relations** — foreign keys are enforced (`PRAGMA foreign_keys = ON` on every
  connection), so referential integrity is real, not optional.
- **Generated columns** — e.g. `total GENERATED ALWAYS AS (unit_cost * quantity)`
  via `execute_schema_query`; the engine keeps them in sync automatically.
- **Import / export** in **CSV, JSON and XLSX** (export accepts a table *or* a
  read-only query; import creates the table from headers/keys when missing).
- **Safety by design** — connection pooling, prepared statements, transactional
  bulk inserts, identifier quoting, and path confinement.
- Tools are labelled `SAFE` / `SCHEMA CHANGE` / `DESTRUCTIVE` / `FILE WRITE` so an
  agent (and its permission layer) can reason about risk.

---

## Requirements

- Node.js `>= 20`
- A package manager. `pnpm` is recommended (the repo pins it via `packageManager`),
  but `npm` works too.

## Installation

### Option A — npm (recommended)

The package is published on npm as
[`mcp-sqlite-tools-plus`](https://www.npmjs.com/package/mcp-sqlite-tools-plus).
No clone or build needed — your MCP client runs it via `npx` (see Configuration).
To try it standalone:

```bash
npx -y mcp-sqlite-tools-plus
```

### Option B — from source

```bash
git clone https://github.com/MauricioPerera/mcp-sqlite-tools-plus.git
cd mcp-sqlite-tools-plus

# with pnpm (recommended)
corepack enable
pnpm install
pnpm build        # outputs dist/index.js

# or with npm
npm install
npm run build
```

The built entry point is `dist/index.js`.

## Configuration

Add the server to your MCP client. Example for **Claude Desktop**
(`claude_desktop_config.json`).

**Using npm (Option A):**

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "mcp-sqlite-tools-plus"],
      "env": {
        "SQLITE_DEFAULT_PATH": "/absolute/path/to/your/databases",
        "SQLITE_ALLOW_ABSOLUTE_PATHS": "false",
        "SQLITE_BUSY_TIMEOUT": "60000",
        "SQLITE_BACKUP_PATH": "/absolute/path/to/your/backups",
        "DEBUG": "false"
      }
    }
  }
}
```

> On Windows, if `npx` is not picked up directly, use
> `"command": "cmd"` with `"args": ["/c", "npx", "-y", "mcp-sqlite-tools-plus"]`.

**From source (Option B):** set `"command": "node"` and
`"args": ["/absolute/path/to/mcp-sqlite-tools-plus/dist/index.js"]`, keeping the
same `env` block.

> Replace the `/absolute/path/...` placeholders with paths on your machine. Restart
> the MCP client after editing its config.

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `SQLITE_DEFAULT_PATH` | current working dir | Base directory for databases. Relative DB paths resolve here. Prefer an absolute, dedicated directory. |
| `SQLITE_ALLOW_ABSOLUTE_PATHS` | `true` ⚠️ | If `true`, the agent can open/write databases anywhere on disk. **Set to `false`** to confine activity to `SQLITE_DEFAULT_PATH`. |
| `SQLITE_BUSY_TIMEOUT` | `30000` | SQLite busy (lock) timeout in ms. Valid range `1000`–`300000`. Not a query-runtime limit. |
| `SQLITE_BACKUP_PATH` | `./backups` | Default destination for `backup_database`. Point it at a dedicated, git-ignored directory. |
| `SQLITE_MAX_QUERY_TIME` | = busy timeout | Deprecated alias of `SQLITE_BUSY_TIMEOUT`. Not a query-runtime limit; do not rely on it. |
| `DEBUG` | `false` | Verbose diagnostic logging to stderr. |

**Hardening recommendation:** `SQLITE_ALLOW_ABSOLUTE_PATHS=false` +
`SQLITE_DEFAULT_PATH` set to a single dedicated folder is the most important
control — it limits what the agent can reach.

The 5 performance PRAGMAs (`journal_mode=WAL`, `synchronous=NORMAL`,
`cache_size`, `foreign_keys=ON`, `temp_store=MEMORY`) are applied automatically on
every connection and are not configurable via env.

---

## Tool catalogue (26 tools)

Legend: ✓ read-only · ⚠️ writes data/schema/files.

**Databases & maintenance**
`open_database` ✓ · `create_database` ⚠️ · `close_database` ✓ · `list_databases` ✓ ·
`database_info` ✓ · `backup_database` ✓ · `vacuum_database` ✓

**Schema & relations**
`list_tables` ✓ · `describe_table` ✓ · `create_table` ⚠️ · `drop_table` ⚠️ ·
`export_schema` ✓ · `import_schema` ⚠️ · `execute_schema_query` ⚠️ (DDL: foreign
keys, generated columns, indexes, …)

**Query & data**
`execute_read_query` ✓ (SELECT/PRAGMA/EXPLAIN, parameterised, JOINs) ·
`execute_write_query` ⚠️ · `bulk_insert` ⚠️

**Transactions**
`begin_transaction` ⚠️ · `commit_transaction` ✓ · `rollback_transaction` ⚠️

**Import / export**
`import_csv` ⚠️ · `export_csv` ⚠️ · **`import_json` ⚠️ (new)** ·
**`export_json` ⚠️ (new)** · **`import_xlsx` ⚠️ (new)** · **`export_xlsx` ⚠️ (new)**

Export tools take **exactly one** of `table` or a read-only `query`. Import tools
create the target table from the file's headers/keys when it does not exist and
insert rows inside a transaction with per-row error reporting.

See [`docs/UPSTREAM_README.md`](docs/UPSTREAM_README.md) for the full per-tool
parameter reference inherited from upstream.

---

## Usage — for users

You talk to your agent in natural language; the agent calls the tools. Examples:

- "Import `sales.xlsx` into a table called `sales`." → `import_xlsx`
- "What columns does the `orders` table have?" → `describe_table`
- "Total revenue per category." → `execute_read_query` with a `GROUP BY`
- "Add an order for customer 3, 5 units at 9.99." → `execute_write_query`
- "Export the orders of June as an Excel file." → `export_xlsx` with a query
- "Make a `total` column that is price × quantity." → `execute_schema_query` with a
  generated column

### Relations and computed columns

```sql
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  quantity INTEGER NOT NULL,
  total REAL GENERATED ALWAYS AS (unit_cost * quantity) STORED,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

`total` is computed by the engine (never inserted by hand), and inserting an order
with a non-existent `customer_id` is rejected by the foreign key.

---

## Usage — for AI agents

Guidance for an agent driving this server:

1. **Discover before you query.** Call `list_tables`, then `describe_table` on the
   relevant tables, to learn columns, types, foreign keys and indexes. Do not guess
   the schema.
2. **Respect the risk labels.** Tools are tagged `SAFE` / `SCHEMA CHANGE` /
   `DESTRUCTIVE` / `FILE WRITE`. Confirm with the user before any non-`SAFE`
   operation, and never issue `UPDATE`/`DELETE` without a `WHERE` clause.
3. **Always parameterise.** Use bound parameters in `execute_read_query` /
   `execute_write_query`; never interpolate user values into SQL strings.
4. **Use transactions** (`begin_transaction` … `commit_transaction` /
   `rollback_transaction`) for multi-step writes; use `bulk_insert` for batches.
5. **Back up before destructive work.** Call `backup_database` before schema
   changes, mass updates or deletes.
6. **Surface what you did.** When returning a computed result, show the SQL you ran
   and/or the affected rows so the user can verify it.
7. **Relations & totals belong in the schema.** Prefer foreign keys and generated
   columns over recomputing values in application/model logic.

---

## Development

```bash
pnpm test          # run the vitest suite
pnpm build         # build dist/index.js
pnpm inspect       # run the MCP inspector against the built server
```

## Security & privacy

- Set `SQLITE_ALLOW_ABSOLUTE_PATHS=false` and a dedicated `SQLITE_DEFAULT_PATH` to
  confine the agent to one directory.
- Foreign keys are enforced on every connection.
- Identifiers are quoted and values are parameterised to avoid SQL injection.
- Keep backups (`SQLITE_BACKUP_PATH`) out of version control.

## Credits & license

- Original project: [`spences10/mcp-sqlite-tools`](https://github.com/spences10/mcp-sqlite-tools)
  by **Scott Spence**.
- Fork (`mcp-sqlite-tools-plus`, JSON/XLSX import-export + hardening) maintained by
  **MauricioPerera**.

Licensed under the **MIT License** — see [`LICENSE`](LICENSE). The original
copyright is retained as required by the license.
