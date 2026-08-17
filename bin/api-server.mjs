#!/usr/bin/env node
/**
 * api-server.mjs — Production Standalone API Server
 *
 * Liveness/readiness probes + /api/v1 auth-scoped routes.
 * Readiness never reports database HEALTHY without a real Postgres ping.
 */

import http from "node:http";
import { getSaaSContainer, AccessGuard, UnauthorizedError, ForbiddenError } from "../lib/saas/saas-container.mjs";
import { EnvConfig } from "../lib/saas/config/env-config.mjs";
import { ServiceLifecycle } from "../lib/saas/lifecycle/service-lifecycle.mjs";
import { ensureDiscoveryPipeline, stopGlobalDiscoveryScheduler } from "../lib/saas/discovery-engine/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  extractSessionToken,
} from "../lib/saas/auth/session-cookie.mjs";

const config = new EnvConfig();
const container = getSaaSContainer();
const lifecycle = new ServiceLifecycle({ container });

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function settingsKey(tenantId, userId) {
  return `${tenantId}:${userId}`;
}

function defaultSettings() {
  return {
    autonomousMode: false,
    autoSubmit: false,
    applicationsPerDay: 10,
    minScore: 70,
    scanIntervalMinutes: 30,
    locations: [],
    remote: "Hybrid / Remote Preferred",
    targetRoles: [],
    safety: {
      requireEligibility: true,
      requireConfidentAnswers: true,
      pauseOnError: true,
      pauseOnCaptcha: true,
      pauseOnAuthFailure: true,
      pauseOnUnexpectedForm: true,
      pauseOnSensitiveQuestion: true,
    },
  };
}

function defaultAgentState() {
  return {
    state: "STOPPED",
    lastRunAt: null,
    config: {},
  };
}

async function requireAuth(req) {
  const token = extractSessionToken(req.headers.cookie, req.headers.authorization);
  if (!token) throw new UnauthorizedError("Authentication required");
  try {
    const auth = await container.authService.verifyToken(token);
    return { ...auth, token };
  } catch (err) {
    throw new UnauthorizedError(err.message || "Invalid or expired session");
  }
}

async function handleApiV1(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method || "GET";

  try {
    // ── Auth: signup ────────────────────────────────────────────────────────
    if (method === "POST" && path === "/api/v1/auth/signup") {
      const body = await readJson(req);
      const { name, email, password } = body;
      if (!email || !password) {
        return json(res, 400, { error: "name, email, and password are required" });
      }
      await container.authService.ensureDefaultTenant();
      const reg = await container.authService.signup({ name: name || "Student", email, password });
      // Auto-login after signup
      const login = await container.authService.authenticateUser(email, password, "default", {
        userAgent: req.headers["user-agent"],
        ipAddress: req.socket?.remoteAddress,
      });
      return json(
        res,
        201,
        { ok: true, user: login.user, token: login.token, expiresAt: login.expiresAt, verificationToken: reg.verificationToken },
        { "Set-Cookie": buildSessionCookie(login.token, { expiresAt: login.expiresAt }) }
      );
    }

    // ── Auth: login ─────────────────────────────────────────────────────────
    if (method === "POST" && path === "/api/v1/auth/login") {
      const body = await readJson(req);
      const { email, password, tenantId } = body;
      if (!email || !password) {
        return json(res, 400, { error: "email and password are required" });
      }
      const login = await container.authService.authenticateUser(email, password, tenantId || null, {
        userAgent: req.headers["user-agent"],
        ipAddress: req.socket?.remoteAddress,
      });
      return json(
        res,
        200,
        { ok: true, user: login.user, token: login.token, expiresAt: login.expiresAt },
        { "Set-Cookie": buildSessionCookie(login.token, { expiresAt: login.expiresAt }) }
      );
    }

    // ── Auth: logout ────────────────────────────────────────────────────────
    if (method === "POST" && path === "/api/v1/auth/logout") {
      const token = extractSessionToken(req.headers.cookie, req.headers.authorization);
      if (token) await container.authService.logout(token);
      return json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    }

    // ── Auth: me ────────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/v1/auth/me") {
      const auth = await requireAuth(req);
      const user = await container.authService.getUserForAuth(auth);
      return json(res, 200, { ok: true, user });
    }

    // Everything below requires auth
    const auth = await requireAuth(req);
    const ctx = { userId: auth.userId, tenantId: auth.tenantId, role: auth.role };

    // ── Profile ─────────────────────────────────────────────────────────────
    if (path === "/api/v1/profile") {
      if (method === "GET") {
        const profile = await container.profileRepository.getByUserId(ctx.userId, ctx.tenantId);
        if (profile) AccessGuard.canAccessProfile(ctx, profile);
        return json(res, 200, { ok: true, profile: profile || null });
      }
      if (method === "PUT") {
        const body = await readJson(req);
        // Reject cross-user writes
        if (body.userId && body.userId !== ctx.userId) {
          throw new ForbiddenError("Cross-user profile write forbidden");
        }
        if (body.tenantId && body.tenantId !== ctx.tenantId) {
          throw new ForbiddenError("Cross-tenant profile write forbidden");
        }
        const profile = await container.profileRepository.upsertProfile(ctx.userId, ctx.tenantId, body);
        AccessGuard.canAccessProfile(ctx, profile);
        return json(res, 200, { ok: true, profile });
      }
    }

    // ── Settings ────────────────────────────────────────────────────────────
    if (path === "/api/v1/settings") {
      const key = settingsKey(ctx.tenantId, ctx.userId);
      if (method === "GET") {
        const settings = container.settingsStore.get(key) || defaultSettings();
        return json(res, 200, { ok: true, settings });
      }
      if (method === "PUT") {
        const body = await readJson(req);
        const prev = container.settingsStore.get(key) || defaultSettings();
        const next = {
          ...prev,
          ...body,
          safety: { ...prev.safety, ...(body.safety || {}) },
        };
        container.settingsStore.set(key, next);
        return json(res, 200, { ok: true, settings: next });
      }
    }

    // ── Opportunities (user-scoped only — never mock / global filler jobs) ──
    if (method === "GET" && path === "/api/v1/opportunities") {
      const items = await container.opportunityRepository.findByFilters(
        {},
        { tenantId: ctx.tenantId, userId: ctx.userId }
      );
      // Strict user scope: only rows owned by this user (no globals, no mocks)
      const scoped = items.filter((o) => o.userId === ctx.userId && o.tenantId === ctx.tenantId);
      return json(res, 200, { ok: true, opportunities: scoped });
    }

    // ── Applications ────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/v1/applications") {
      const apps = await container.applicationRepository.findMany({}, ctx);
      for (const app of apps) AccessGuard.canAccessApplication(ctx, app);
      return json(res, 200, { ok: true, applications: apps });
    }

    // ── Agent status / control ──────────────────────────────────────────────
    if (path === "/api/v1/agent/status" && method === "GET") {
      const key = settingsKey(ctx.tenantId, ctx.userId);
      const state = container.agentStateStore.get(key) || defaultAgentState();
      return json(res, 200, { ok: true, agent: state });
    }

    if (path === "/api/v1/agent/control" && (method === "POST" || method === "GET")) {
      const key = settingsKey(ctx.tenantId, ctx.userId);
      const prev = container.agentStateStore.get(key) || defaultAgentState();
      if (method === "GET") {
        return json(res, 200, { ok: true, agent: prev });
      }
      const body = await readJson(req);
      const action = String(body.action || "").toUpperCase();
      let next = { ...prev };
      if (action === "START" || action === "RESUME") {
        next.state = "RUNNING";
        next.lastRunAt = new Date().toISOString();
      } else if (action === "PAUSE") {
        next.state = "PAUSED";
      } else if (action === "STOP") {
        next.state = "STOPPED";
      } else if (body.state) {
        next.state = body.state;
      }
      if (body.config) next.config = { ...next.config, ...body.config };
      container.agentStateStore.set(key, next);
      return json(res, 200, { ok: true, agent: next });
    }

    // ── Usage ───────────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/v1/usage") {
      const metrics = await container.applicationRepository.getMetrics?.(ctx.userId, ctx.tenantId);
      return json(res, 200, {
        ok: true,
        usage: metrics || {
          applicationsCount: 0,
          aiTokensUsed: 0,
          aiRequestsCount: 0,
          browserSessionsCount: 0,
        },
      });
    }

    // ── Notifications ───────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/v1/notifications") {
      const key = settingsKey(ctx.tenantId, ctx.userId);
      const list = container.notificationStore.get(key) || [];
      return json(res, 200, { ok: true, notifications: list });
    }

    return json(res, 404, { error: "Not found", path });
  } catch (err) {
    const status = err.status || err.statusCode || (err instanceof UnauthorizedError ? 401 : err instanceof ForbiddenError ? 403 : 400);
    return json(res, status, { error: err.message || "Request failed" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz" || url.pathname === "/health") {
    return json(res, 200, lifecycle.getLiveness());
  }

  if (url.pathname === "/readyz" || url.pathname === "/ready") {
    const ready = await lifecycle.getReadiness();
    return json(res, ready.ready ? 200 : 503, ready);
  }

  if (url.pathname === "/metrics") {
    const metrics = await container.jobQueue.getQueueMetrics();
    return json(res, 200, metrics);
  }

  if (url.pathname.startsWith("/api/v1")) {
    return handleApiV1(req, res, url);
  }

  return json(res, 200, {
    service: "StudentCareer AI API Gateway",
    version: "2.0.0",
    environment: config.nodeEnv,
    endpoints: [
      "/healthz",
      "/readyz",
      "/metrics",
      "/api/v1/auth/signup",
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/auth/me",
      "/api/v1/profile",
      "/api/v1/settings",
      "/api/v1/opportunities",
      "/api/v1/applications",
      "/api/v1/agent/status",
      "/api/v1/agent/control",
      "/api/v1/usage",
      "/api/v1/notifications",
    ],
    cookie: SESSION_COOKIE_NAME,
    timestamp: new Date().toISOString(),
  });
});

async function boot() {
  try {
    if (container.userStore) {
      await container.authService.ensureDefaultTenant();
      console.log("[APIServer] Default tenant ensured in PostgreSQL");
    } else {
      await container.authService.ensureDefaultTenant();
      console.warn("[APIServer] DATABASE_URL not set — AuthService using in-memory Maps; /readyz will report database UNHEALTHY");
    }
  } catch (err) {
    console.error("[APIServer] Failed to ensure default tenant:", err.message);
  }

  const port = config.server.apiPort || 4000;
  server.listen(port, config.server.host, () => {
    console.log(
      `[APIServer] StudentCareer AI API Gateway listening on http://${config.server.host}:${port} (${config.nodeEnv})`
    );
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    ensureDiscoveryPipeline({ container, repoRoot });
  });
}

lifecycle.setupGracefulShutdown({
  server,
  cleanupFns: [
    async () => {
      stopGlobalDiscoveryScheduler();
      if (container.postgresClient) await container.postgresClient.close();
    },
  ],
});

boot();
