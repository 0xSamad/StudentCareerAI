/**
 * migration-runner.mjs — PostgreSQL Sequential Migration Runner
 *
 * Discovers and applies sequential SQL migrations in transaction blocks,
 * tracking applied migrations in `_schema_migrations`.
 *
 * When DATABASE_URL is set (real client): executes full SQL files against Postgres.
 * When mock: records migrations as applied for offline discovery tests without pretending DB is healthy.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MigrationRunner {
  constructor({ client, migrationsDir } = {}) {
    this.client = client;
    this.migrationsDir = migrationsDir || path.join(__dirname, "migrations");
  }

  /**
   * Ensure `_schema_migrations` tracking table exists.
   */
  async ensureMigrationTable() {
    const ddl = `
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `;
    if (this.client) {
      await this.client.query(ddl);
    }
  }

  /**
   * List all available migration files in the migrations directory.
   */
  getAvailableMigrations() {
    if (!fs.existsSync(this.migrationsDir)) return [];
    return fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((fileName) => {
        const fullPath = path.join(this.migrationsDir, fileName);
        const version = fileName.split("_")[0];
        return {
          version,
          name: fileName,
          path: fullPath,
          sql: fs.readFileSync(fullPath, "utf-8"),
        };
      });
  }

  async _isApplied(version) {
    if (!this.client || this.client.isMock) return false;
    try {
      const { rows } = await this.client.query(
        `SELECT version FROM _schema_migrations WHERE version = $1`,
        [version]
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Run pending migrations.
   * Real DB: apply full SQL. Mock: mark as APPLIED for offline suite compatibility.
   */
  async runMigrations() {
    if (!this.client) {
      throw new Error("MigrationRunner requires a PostgresClient");
    }

    await this.ensureMigrationTable();
    const available = this.getAvailableMigrations();
    const appliedRecords = [];

    for (const migration of available) {
      if (!this.client.isMock) {
        const already = await this._isApplied(migration.version);
        if (already) {
          appliedRecords.push({ version: migration.version, name: migration.name, status: "SKIPPED" });
          continue;
        }

        await this.client.withTransaction(async (txClient) => {
          // Split on statement boundaries carefully: run whole file via client.query
          // pg accepts multi-statement strings when not using prepared extended protocol with params.
          await txClient.query(migration.sql);
          await txClient.query(
            `INSERT INTO _schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW()) ON CONFLICT (version) DO NOTHING`,
            [migration.version, migration.name]
          );
        });
        appliedRecords.push({ version: migration.version, name: migration.name, status: "APPLIED" });
      } else {
        // Offline / unit-test path — do not pretend the database is healthy.
        await this.client.withTransaction(async (txClient) => {
          await txClient.query(migration.sql);
          await txClient.query(
            "INSERT INTO _schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW()) ON CONFLICT (version) DO NOTHING;",
            [migration.version, migration.name]
          );
        });
        appliedRecords.push({ version: migration.version, name: migration.name, status: "APPLIED" });
      }
    }

    return appliedRecords;
  }
}
