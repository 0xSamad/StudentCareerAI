#!/usr/bin/env node
/**
 * postgres-dev.mjs — Start embedded PostgreSQL for local SaaS development (no Docker).
 *
 * Usage:
 *   node bin/postgres-dev.mjs start   # start server (background-friendly)
 *   node bin/postgres-dev.mjs stop    # stop server
 *   node bin/postgres-dev.mjs status  # check if port responds
 *
 * Data persists under data/postgres-dev/
 */

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

const PID_FILE = path.join(root, "data", "postgres-dev", ".server.pid");
const DATA_DIR = path.join(root, "data", "postgres-dev", "cluster");

const user = process.env.POSTGRES_USER || "career_prod_user";
const password = process.env.POSTGRES_PASSWORD || "career_dev_pass_change_me";
const port = parseInt(process.env.POSTGRES_PORT || "5432", 10);
const database = process.env.POSTGRES_DB || "student_career_ai_prod";

function pgConfig() {
  return {
    databaseDir: DATA_DIR,
    user,
    password,
    port,
    persistent: true,
  };
}

async function start() {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  const pg = new EmbeddedPostgres(pgConfig());
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database).catch(() => {
    /* already exists */
  });
  fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  const url = `postgresql://${user}:${password}@localhost:${port}/${database}`;
  console.log(`[postgres-dev] Running at ${url}`);
  console.log("[postgres-dev] Press Ctrl+C to stop.");

  const shutdown = async () => {
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function stop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log("[postgres-dev] No pid file — server may not be running.");
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[postgres-dev] Sent SIGTERM to pid ${pid}`);
  } catch (err) {
    console.error("[postgres-dev] Could not stop process:", err.message);
  }
}

async function status() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await client.connect();
    const r = await client.query("SELECT 1 AS ok");
    console.log("[postgres-dev] HEALTHY", r.rows[0]);
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error("[postgres-dev] UNREACHABLE:", err.message);
    process.exit(1);
  }
}

const cmd = process.argv[2] || "start";
if (cmd === "start") {
  start().catch((err) => {
    console.error("[postgres-dev] Fatal:", err.message || err);
    process.exit(1);
  });
} else if (cmd === "stop") {
  stop();
} else if (cmd === "status") {
  status();
} else {
  console.error("Usage: node bin/postgres-dev.mjs {start|stop|status}");
  process.exit(1);
}
