/**
 * service-lifecycle.mjs — Production Service Health, Readiness & Graceful Shutdown
 *
 * Implements:
 * - Liveness Check (`/healthz`): Process status and uptime
 * - Readiness Check (`/readyz`): Database, storage, and worker subsystem availability
 * - Graceful Shutdown Manager: Handles SIGTERM/SIGINT with clean resource disposal
 *
 * Readiness never lies: database is HEALTHY only when a real Postgres ping succeeds.
 */

export class ServiceLifecycle {
  constructor(options = {}) {
    this.startTime = Date.now();
    this.isShuttingDown = false;
    this.container = options.container || null;
  }

  /**
   * Liveness Probe: returns status OK if process is running and not shutting down.
   */
  getLiveness() {
    return {
      status: this.isShuttingDown ? "SHUTTING_DOWN" : "OK",
      alive: !this.isShuttingDown,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  /**
   * Readiness Probe: checks database, storage, and subsystem health.
   * Database HEALTHY only if postgresClient.ping() succeeds against a real DB.
   */
  async getReadiness(container = this.container) {
    if (this.isShuttingDown) {
      return {
        ready: false,
        status: "SHUTTING_DOWN",
        alive: false,
        checks: {},
        timestamp: new Date().toISOString(),
      };
    }

    const checks = {
      database: "UNKNOWN",
      storage: "UNKNOWN",
      workerPool: "UNKNOWN",
    };

    let allReady = true;

    // 1. Database Check — real ping only; mock / missing URL = UNHEALTHY
    try {
      const pg = container?.postgresClient || null;
      if (!pg) {
        checks.database = "UNHEALTHY: no postgresClient (DATABASE_URL not configured)";
        allReady = false;
      } else if (pg.isMock) {
        checks.database = "UNHEALTHY: mock client (DATABASE_URL not set)";
        allReady = false;
      } else {
        const ok = await pg.ping();
        if (ok) {
          checks.database = "HEALTHY";
        } else {
          checks.database = "UNHEALTHY: ping failed (SELECT 1)";
          allReady = false;
        }
      }
    } catch (err) {
      checks.database = `UNHEALTHY: ${err.message}`;
      allReady = false;
    }

    // 2. Storage Check
    try {
      if (container?.storageService) {
        checks.storage = "HEALTHY";
      } else {
        checks.storage = "NOT_CONFIGURED";
        allReady = false;
      }
    } catch (err) {
      checks.storage = `UNHEALTHY: ${err.message}`;
      allReady = false;
    }

    // 3. Worker Pool Check (optional — missing does not block readiness in local)
    try {
      if (container?.workerPool) {
        checks.workerPool = "HEALTHY";
      } else {
        checks.workerPool = "NOT_CONFIGURED";
      }
    } catch (err) {
      checks.workerPool = `UNHEALTHY: ${err.message}`;
      allReady = false;
    }

    return {
      ready: allReady,
      status: allReady ? "READY" : "NOT_READY",
      alive: true,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Attach graceful shutdown signal handlers to the Node.js process.
   */
  setupGracefulShutdown({ server, workerPool, cleanupFns = [], shutdownTimeoutMs = 15000 } = {}) {
    const handleSignal = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log(`\n[ServiceLifecycle] Received ${signal}. Commencing graceful shutdown (timeout: ${shutdownTimeoutMs}ms)...`);

      const forceExitTimer = setTimeout(() => {
        console.error("[ServiceLifecycle] Graceful shutdown timed out. Forcing termination.");
        process.exit(1);
      }, shutdownTimeoutMs);

      try {
        if (server && typeof server.close === "function") {
          console.log("[ServiceLifecycle] Closing HTTP listener...");
          await new Promise((res) => server.close(res));
        }

        if (workerPool && typeof workerPool.stop === "function") {
          console.log("[ServiceLifecycle] Stopping worker pool event loop...");
          workerPool.stop();
        }

        for (const fn of cleanupFns) {
          if (typeof fn === "function") {
            try {
              await fn();
            } catch (err) {
              console.error("[ServiceLifecycle] Error during cleanup function:", err.message);
            }
          }
        }

        clearTimeout(forceExitTimer);
        console.log("[ServiceLifecycle] Graceful shutdown completed cleanly.");
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExitTimer);
        console.error("[ServiceLifecycle] Fatal error during shutdown:", err);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => handleSignal("SIGTERM"));
    process.on("SIGINT", () => handleSignal("SIGINT"));
  }
}
