// PostgreSQL catalog metadata queries. Pure SQL against pg_catalog — no UI
// logic here. All identifiers (schema/table) are passed as parameters, never
// concatenated into SQL text.

import type { QueryResultRow } from 'pg'
import type {
  ExplorerNode,
  ExploreSource,
  TableColumnMeta,
  TableStructureInfo,
  TableIndexInfo,
  TableConstraintInfo,
  TableForeignKeyInfo,
  TableTriggerInfo,
  TableSearchResult
} from '@shared/models/explorer'

/** Minimal client surface satisfied by pg PoolClient / Client. */
export interface SqlClient {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>
}

function node(
  kind: ExplorerNode['kind'],
  name: string,
  key: string,
  hasChildren: boolean,
  extra: Partial<ExplorerNode> = {}
): ExplorerNode {
  return { kind, name, key, hasChildren, ...extra }
}

export async function explorePostgres(
  q: SqlClient,
  source: ExploreSource
): Promise<ExplorerNode[]> {
  switch (source.kind) {
    case 'roots':
      return [
        node('databases', 'Databases', 'databases', true),
        node('schemas', 'Schemas', 'schemas', true),
        node('extensions', 'Extensions', 'extensions', true)
      ]

    case 'databases': {
      const r = await q.query<{ name: string }>(
        `SELECT datname AS name FROM pg_database WHERE datallowconn ORDER BY datname`
      )
      return r.rows.map((row) => node('database', row.name, `database:${row.name}`, false))
    }

    case 'schemas': {
      const r = await q.query<{ name: string; count: string }>(
        `SELECT n.nspname AS name,
                (SELECT count(*) FROM pg_class c
                  WHERE c.relnamespace = n.oid AND c.relkind IN ('r','p'))::text AS count
           FROM pg_namespace n
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          ORDER BY n.nspname`
      )
      return r.rows.map((row) =>
        node('schema', row.name, `schema:${row.name}`, true, { count: Number(row.count) })
      )
    }

    case 'schema-sections': {
      const s = source.schema
      return [
        node('tables', 'Tables', `tables:${s}`, true),
        node('views', 'Views', `views:${s}`, true),
        node('matviews', 'Materialized Views', `matviews:${s}`, true),
        node('functions', 'Functions', `functions:${s}`, true),
        node('procedures', 'Procedures', `procedures:${s}`, true),
        node('sequences', 'Sequences', `sequences:${s}`, true),
        node('types', 'Types', `types:${s}`, true)
      ]
    }

    case 'table-sections': {
      const s = source.schema
      const t = source.table
      return [
        node('columns', 'Columns', `table-columns:${s}:${t}`, true),
        node('indexes', 'Indexes', `table-indexes:${s}:${t}`, true),
        node('foreign-keys', 'Foreign Keys', `table-fks:${s}:${t}`, true),
        node('constraints', 'Constraints', `table-constraints:${s}:${t}`, true),
        node('triggers', 'Triggers', `table-triggers:${s}:${t}`, true)
      ]
    }

    case 'schema-tables':
      return queryRels(q, source.schema, ['r', 'p'], 'table')
    case 'schema-views':
      return queryRels(q, source.schema, ['v'], 'view')
    case 'schema-matviews':
      return queryRels(q, source.schema, ['m'], 'matview')

    case 'schema-functions': {
      const r = await q.query<{ name: string; args: string }>(
        `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1 AND p.prokind = 'f'
          ORDER BY p.proname`,
        [source.schema]
      )
      return r.rows.map((row) =>
        node('function', `${row.name}(${row.args})`, `function:${source.schema}:${row.name}`, false)
      )
    }

    case 'schema-procedures': {
      const r = await q.query<{ name: string; args: string }>(
        `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1 AND p.prokind = 'p'
          ORDER BY p.proname`,
        [source.schema]
      )
      return r.rows.map((row) =>
        node('procedure', `${row.name}(${row.args})`, `procedure:${source.schema}:${row.name}`, false)
      )
    }

    case 'schema-sequences': {
      const r = await q.query<{ name: string }>(
        `SELECT c.relname AS name
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = 'S' ORDER BY c.relname`,
        [source.schema]
      )
      return r.rows.map((row) =>
        node('sequence', row.name, `sequence:${source.schema}:${row.name}`, false)
      )
    }

    case 'schema-types': {
      const r = await q.query<{ name: string; kind: string }>(
        `SELECT t.typname AS name,
                CASE t.typtype WHEN 'b' THEN 'base' WHEN 'e' THEN 'enum' WHEN 'r' THEN 'range'
                               WHEN 'd' THEN 'domain' WHEN 'c' THEN 'composite' END AS kind
           FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = $1 AND t.typtype IN ('b','e','r','d','c') AND t.typrelid = 0
          ORDER BY t.typname`,
        [source.schema]
      )
      return r.rows.map((row) =>
        node('type', row.name, `type:${source.schema}:${row.name}`, false, {
          meta: { kind: row.kind }
        })
      )
    }

    case 'schema-extensions': {
      const r = await q.query<{ name: string; version: string }>(
        `SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY extname`
      )
      return r.rows.map((row) =>
        node('extension', row.name, `extension:${row.name}`, false, {
          meta: { version: row.version }
        })
      )
    }

    case 'table-columns':
    case 'view-columns':
    case 'matview-columns':
      return (await columnsForTable(q, source.schema, source.table)).map((c) =>
        node('column', c.name, `column:${source.schema}:${source.table}:${c.name}`, false, {
          meta: { dataType: c.dataType, nullable: c.nullable, isPk: c.isPk }
        })
      )

    case 'table-indexes':
      return queryDefs(
        q,
        `SELECT i.relname AS name,
                pg_get_indexdef(idx.indexrelid) AS definition,
                idx.indisprimary AS "isPrimary",
                idx.indisunique AS "isUnique"
           FROM pg_index idx
           JOIN pg_class t ON t.oid = idx.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class i ON i.oid = idx.indexrelid
          WHERE n.nspname = $1 AND t.relname = $2
          ORDER BY idx.indisprimary DESC, i.relname`,
        'index',
        [source.schema, source.table]
      )

    case 'table-fks':
      return queryDefs(
        q,
        `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS definition
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1 AND t.relname = $2 AND con.contype = 'f'
          ORDER BY con.conname`,
        'foreign-key',
        [source.schema, source.table]
      )

    case 'table-constraints': {
      const r = await q.query<{ name: string; definition: string; type: string }>(
        `SELECT con.conname AS name,
                pg_get_constraintdef(con.oid) AS definition,
                con.contype AS type
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1 AND t.relname = $2 AND con.contype <> 'f'
          ORDER BY con.conname`,
        [source.schema, source.table]
      )
      const labels: Record<string, string> = { p: 'primary', u: 'unique', c: 'check', x: 'exclusion' }
      return r.rows.map((row) =>
        node(
          'constraint',
          `${row.name} (${labels[row.type] ?? row.type})`,
          `constraint:${source.schema}:${source.table}:${row.name}`,
          false,
          { comment: row.definition }
        )
      )
    }

    case 'table-triggers': {
      const r = await q.query<{ name: string; definition: string; enabled: string }>(
        `SELECT tg.tgname AS name, pg_get_triggerdef(tg.oid) AS definition,
                CASE WHEN tg.tgenabled = 'D' THEN 'disabled' ELSE 'enabled' END AS enabled
           FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND NOT tg.tgisinternal
          ORDER BY tg.tgname`,
        [source.schema, source.table]
      )
      return r.rows.map((row) =>
        node(
          'trigger',
          `${row.name} (${row.enabled})`,
          `trigger:${source.schema}:${source.table}:${row.name}`,
          false,
          { comment: row.definition }
        )
      )
    }

    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function queryRels(
  q: SqlClient,
  schema: string,
  kinds: string[],
  kind: 'table' | 'view' | 'matview'
): Promise<ExplorerNode[]> {
  const r = await q.query<{ name: string; comment: string | null }>(
    `SELECT c.relname AS name, obj_description(c.oid) AS comment
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = ANY($2::"char"[])
      ORDER BY c.relname`,
    [schema, kinds]
  )
  const ck =
    kind === 'table' ? 'table' : kind === 'view' ? 'view-columns' : 'matview-columns'
  return r.rows.map((row) =>
    node(kind as ExplorerNode['kind'], row.name, `${ck}:${schema}:${row.name}`, true, {
      comment: row.comment ?? undefined,
      meta: { schema, table: row.name }
    })
  )
}

async function queryDefs(
  q: SqlClient,
  sql: string,
  kind: 'index' | 'foreign-key',
  params: unknown[]
): Promise<ExplorerNode[]> {
  const r = await q.query<{ name: string; definition: string; isPrimary?: boolean; isUnique?: boolean }>(
    sql,
    params
  )
  const schema = String(params[0] ?? '')
  const table = String(params[1] ?? '')
  return r.rows.map((row) =>
    node(kind, row.name, `${kind}:${schema}:${table}:${row.name}`, false, {
      comment: row.definition,
      meta: {
        schema,
        table,
        isPrimary: Boolean(row.isPrimary),
        isUnique: Boolean(row.isUnique),
        definition: row.definition
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Column metadata (used by the explorer AND by safe-edit planning)
// ---------------------------------------------------------------------------

/**
 * Resolves an unqualified table name against the session search_path
 * (current_schemas(true)). Returns the schema of the first visible relation,
 * or null when no such table is visible. Used by safe-edit planning so
 * `SELECT id FROM users` behaves like a qualified reference.
 */
export async function resolveVisibleSchema(q: SqlClient, table: string): Promise<string | null> {
  const res = await q.query<{ schema: string }>(
    `select n.nspname as schema
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relname = $1
        and c.relkind in ('r', 'p', 'v', 'm')
        and n.nspname = any (current_schemas(true))
      order by array_position(current_schemas(true), n.nspname)
      limit 1`,
    [table]
  )
  return res.rows[0]?.schema ?? null
}

export async function columnsForTable(
  q: SqlClient,
  schema: string,
  table: string,
  _withPk = true
): Promise<TableColumnMeta[]> {
  const r = await q.query<{
    name: string
    dataType: string
    nullable: boolean
    position: number
    defaultValue: string | null
    comment: string | null
    isPk: boolean
  }>(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS "dataType",
            NOT a.attnotnull AS nullable,
            a.attnum AS position,
            pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
            col_description(a.attrelid, a.attnum) AS comment,
            EXISTS (
              SELECT 1 FROM pg_constraint pc
               WHERE pc.conrelid = c.oid AND pc.contype = 'p' AND a.attnum = ANY (pc.conkey)
            ) AS "isPk"
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relname = $2
        AND c.relkind IN ('r','p','v','m')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [schema, table]
  )
  return r.rows.map((row) => ({
    name: row.name,
    dataType: row.dataType,
    nullable: row.nullable,
    isPk: row.isPk,
    position: row.position,
    defaultValue: row.defaultValue,
    comment: row.comment
  }))
}

export async function tableColumnNames(
  q: SqlClient,
  schema: string,
  table: string
): Promise<string[]> {
  const cols = await columnsForTable(q, schema, table)
  return cols.map((c) => c.name)
}

export async function relationExists(
  q: SqlClient,
  schema: string,
  table: string
): Promise<boolean> {
  const r = await q.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r','p','v','m')
     ) AS exists`,
    [schema, table]
  )
  return r.rows[0]?.exists ?? false
}

export function generateTableDdl(
  schema: string,
  table: string,
  columns: TableColumnMeta[],
  indexes: TableIndexInfo[],
  constraints: TableConstraintInfo[]
): string {
  const lines: string[] = []
  for (const c of columns) {
    let colDef = `  "${c.name}" ${c.dataType}`
    if (!c.nullable) colDef += ' NOT NULL'
    if (c.defaultValue) colDef += ` DEFAULT ${c.defaultValue}`
    lines.push(colDef)
  }
  for (const con of constraints) {
    lines.push(`  CONSTRAINT "${con.name}" ${con.definition}`)
  }
  let ddl = `CREATE TABLE "${schema}"."${table}" (\n${lines.join(',\n')}\n);\n`
  if (indexes.length > 0) {
    ddl += '\n' + indexes.map((idx) => (idx.definition.endsWith(';') ? idx.definition : idx.definition + ';')).join('\n') + '\n'
  }
  return ddl
}

export async function getTableStructure(
  q: SqlClient,
  schema: string,
  table: string
): Promise<TableStructureInfo> {
  const relRes = await q.query<{ kind: string; comment: string | null }>(
    `SELECT c.relkind AS kind, obj_description(c.oid) AS comment
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, table]
  )
  const relKind = relRes.rows[0]?.kind === 'v' ? 'view' : relRes.rows[0]?.kind === 'm' ? 'matview' : 'table'
  const comment = relRes.rows[0]?.comment ?? undefined

  const columns = await columnsForTable(q, schema, table, true)

  const idxRes = await q.query<{
    name: string
    definition: string
    isPrimary: boolean
    isUnique: boolean
  }>(
    `SELECT i.relname AS name,
            pg_get_indexdef(idx.indexrelid) AS definition,
            idx.indisprimary AS "isPrimary",
            idx.indisunique AS "isUnique"
       FROM pg_index idx
       JOIN pg_class t ON t.oid = idx.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class i ON i.oid = idx.indexrelid
      WHERE n.nspname = $1 AND t.relname = $2
      ORDER BY idx.indisprimary DESC, i.relname`,
    [schema, table]
  )
  const indexes: TableIndexInfo[] = idxRes.rows.map((r) => ({
    name: r.name,
    definition: r.definition,
    isPrimary: r.isPrimary,
    isUnique: r.isUnique
  }))

  const conRes = await q.query<{ name: string; definition: string; type: string }>(
    `SELECT con.conname AS name,
            pg_get_constraintdef(con.oid) AS definition,
            CASE con.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'u' THEN 'UNIQUE'
              WHEN 'c' THEN 'CHECK'
              WHEN 'f' THEN 'FOREIGN KEY'
              WHEN 'x' THEN 'EXCLUSION'
              ELSE con.contype::text
            END AS type
       FROM pg_constraint con
       JOIN pg_class t ON t.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relname = $2
      ORDER BY con.contype, con.conname`,
    [schema, table]
  )
  const constraints: TableConstraintInfo[] = conRes.rows.map((r) => ({
    name: r.name,
    type: r.type,
    definition: r.definition
  }))

  const fkRes = await q.query<{ name: string; definition: string }>(
    `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class t ON t.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relname = $2 AND con.contype = 'f'
      ORDER BY con.conname`,
    [schema, table]
  )
  const foreignKeys: TableForeignKeyInfo[] = fkRes.rows.map((r) => ({
    name: r.name,
    definition: r.definition
  }))

  const trgRes = await q.query<{ name: string; definition: string; enabled: string }>(
    `SELECT tg.tgname AS name, pg_get_triggerdef(tg.oid) AS definition,
            CASE WHEN tg.tgenabled = 'D' THEN 'disabled' ELSE 'enabled' END AS enabled
       FROM pg_trigger tg
       JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND NOT tg.tgisinternal
      ORDER BY tg.tgname`,
    [schema, table]
  )
  const triggers: TableTriggerInfo[] = trgRes.rows.map((r) => ({
    name: r.name,
    definition: r.definition,
    enabled: r.enabled
  }))

  const ddl = generateTableDdl(schema, table, columns, indexes, constraints)

  return {
    schema,
    table,
    kind: relKind,
    columns,
    indexes,
    constraints,
    foreignKeys,
    triggers,
    comment,
    ddl
  }
}

export async function searchTables(
  q: SqlClient,
  query: string
): Promise<TableSearchResult[]> {
  const qClean = query.trim()
  const r = await q.query<{ schema: string; name: string; kind: 'table' | 'view' | 'matview'; comment: string | null }>(
    `SELECT n.nspname AS schema, c.relname AS name,
            CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' END AS kind,
            obj_description(c.oid) AS comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND c.relkind IN ('r', 'p', 'v', 'm')
        AND ($1 = '' OR c.relname ILIKE ('%' || $1 || '%'))
      ORDER BY c.relname
      LIMIT 200`,
    [qClean]
  )
  return r.rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    kind: row.kind,
    comment: row.comment ?? undefined
  }))
}

