/**
 * postgres-client.mjs — PostgreSQL Connection Pool & Transaction Manager
 *
 * When DATABASE_URL (or options.connectionString) is set: real pg.Pool.
 * When not set: isMock=true — queries are no-ops for offline unit tests;
 * ping() always fails / reports unhealthy (never pretends the DB is up).
 */

import pg from "pg";

const { Pool } = pg;

export class PostgresClient {
  /**
   * @param {object} [options]
   * @param {string|null} [options.connectionString]
   * @param {number} [options.max]
   * @param {boolean} [options.ssl]
   */
  constructor(options = {}) {
    const fromEnv = process.env.DATABASE_URL?.trim() || null;
    this.connectionString =
      options.connectionString !== undefined ? options.connectionString : fromEnv;
    this.isMock = !this.connectionString;
    this.pool = null;
    /** @type {Map<string, Map<string, any>>} in-memory DDL stubs for offline tests */
    this.tables = new Map();
    this._poolOptions = {
      max: options.max ?? parseInt(process.env.DATABASE_MAX_POOL || "20", 10),
      ssl: options.ssl ?? (process.env.DATABASE_SSL === "true" || process.env.DATABASE_SSL === "1"),
    };

    if (!this.isMock) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        max: this._poolOptions.max,
        ssl: this._poolOptions.ssl ? { rejectUnauthorized: false } : undefined,
      });
    }
  }

  /**
   * Execute a parameterized query.
   * Real mode: delegates to pg.Pool.
   * Mock mode: accepts DDL stubs for offline tests; DML returns empty rows.
   *
   * @param {string} sql
   * @param {any[]} [params=[]]
   * @returns {Promise<{ rows: any[], rowCount: number }>}
   */
  async query(sql, params = []) {
    if (!this.isMock && this.pool) {
      const result = await this.pool.query(sql, params);
      return { rows: result.rows || [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
    }

    const trimmed = String(sql || "").trim();
    if (
      trimmed.startsWith("CREATE TABLE") ||
      trimmed.startsWith("CREATE EXTENSION") ||
      trimmed.startsWith("CREATE INDEX") ||
      trimmed.startsWith("CREATE OR REPLACE")
    ) {
      const match = trimmed.match(/CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z0-9_]+)/i);
      if (match) {
        const tbl = match[1].toLowerCase();
        if (!this.tables.has(tbl)) this.tables.set(tbl, new Map());
      }
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  /**
   * Execute operations within a transactional block.
   *
   * @param {Function} callback - async (txClient) => any
   * @returns {Promise<any>}
   */
  async withTransaction(callback) {
    if (this.isMock || !this.pool) {
      try {
        return await callback(this);
      } catch (err) {
        throw err;
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txWrapper = {
        query: async (sql, params = []) => {
          const result = await client.query(sql, params);
          return { rows: result.rows || [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
        },
        withTransaction: async (inner) => inner(txWrapper),
        isMock: false,
      };
      const result = await callback(txWrapper);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Health probe: SELECT 1 against a real pool, or fail when mock / unreachable.
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (this.isMock || !this.pool) {
      return false;
    }
    try {
      const result = await this.pool.query("SELECT 1 AS ok");
      return Array.isArray(result.rows) && result.rows.length > 0;
    } catch {
      return false;
    }
  }

  async close() {
    this.tables.clear();
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
