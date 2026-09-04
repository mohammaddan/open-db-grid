// Shared integration-test infrastructure: connects to a real PostgreSQL
// (docker: scripts/dev-postgres.sh up) and seeds a disposable schema.

import { Client } from 'pg'
import type { DbConnection } from '@shared/models/connection'
import { driverRegistry } from '@main/database/driverRegistry'
import type { DriverSession } from '@main/database/DatabaseDriver'

export const PG_URL =
  process.env.DB_CLIENT_TEST_PG_URL ??
  'postgresql://dbforge:dbforge@127.0.0.1:54329/dbforge_test'

function parseUrl(url: string): {
  host: string
  port: number
  database: string
  user: string
  password: string
} {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, ''),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password)
  }
}

export const PG = parseUrl(PG_URL)

let availability: Promise<boolean> | null = null

/** Resolves once per process: is a real PostgreSQL reachable? */
export function pgAvailable(): Promise<boolean> {
  availability ??= (async () => {
    try {
      const c = new Client({ ...PG, connectionTimeoutMillis: 3000 })
      await c.connect()
      await c.end()
      return true
    } catch {
      return false
    }
  })()
  return availability
}

let seeded: Promise<void> | null = null

/** Idempotent schema seed: tables, view, matview, function, sequence, fks. */
export function seedDatabase(): Promise<void> {
  seeded ??= (async () => {
    const c = new Client(PG)
    await c.connect()
    try {
      // Vitest workers seed concurrently; the advisory lock serializes them.
      await c.query('BEGIN')
      await c.query('SELECT pg_advisory_xact_lock(918273645)')
      await c.query(`
        DROP MATERIALIZED VIEW IF EXISTS mv_user_stats;
        DROP VIEW IF EXISTS v_users;
        DROP TABLE IF EXISTS order_items;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS no_pk_table;
        DROP FUNCTION IF EXISTS add_one(int);
        DROP SEQUENCE IF EXISTS seq_test;

        CREATE TABLE users (
          id         serial PRIMARY KEY,
          name       text NOT NULL,
          email      text UNIQUE,
          active     boolean NOT NULL DEFAULT true,
          score      numeric(10,2),
          meta       jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        INSERT INTO users (name, email, score, meta)
        SELECT 'user ' || g,
               'u' || g || '@example.com',
               round((g % 100)::numeric, 2),
               jsonb_build_object('n', g)
        FROM generate_series(1, 1200) g;

        CREATE TABLE order_items (
          id      serial PRIMARY KEY,
          user_id int NOT NULL REFERENCES users (id),
          amount  numeric(10,2) NOT NULL
        );
        INSERT INTO order_items (user_id, amount)
        SELECT id, (id % 50)::numeric FROM users LIMIT 200;

        CREATE VIEW v_users AS SELECT id, name, email FROM users;
        CREATE MATERIALIZED VIEW mv_user_stats AS SELECT count(*) AS total FROM users;
        CREATE TABLE no_pk_table (a int, b text);
        CREATE FUNCTION add_one(int) RETURNS int AS $$ SELECT $1 + 1 $$ LANGUAGE sql;
        CREATE SEQUENCE seq_test;
      `)
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      await c.end()
    }
  })()
  return seeded
}

export function makeConnection(overrides: Partial<DbConnection> = {}): DbConnection {
  return {
    id: 'it-' + Math.random().toString(36).slice(2, 8),
    name: 'Integration PG',
    driver: 'postgresql',
    config: {
      host: PG.host,
      port: PG.port,
      database: PG.database,
      username: PG.user,
      ssl: { mode: 'disable' },
      connectTimeoutMs: 5000,
      poolSize: 4
    },
    accessMode: 'read-write',
    production: false,
    color: 'blue',
    tags: ['integration'],
    groupId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

/** Opens a real driver session through the registry (the same path the app uses). */
export async function connectSession(overrides: Partial<DbConnection> = {}): Promise<DriverSession> {
  const factory = driverRegistry.forEngine('postgresql')
  const connection = makeConnection(overrides)
  return factory.connect({
    connection,
    secretProvider: async () => PG.password
  })
}
