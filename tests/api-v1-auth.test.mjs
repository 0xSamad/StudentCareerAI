// tests/api-v1-auth.test.mjs — Signup / login / me isolation via in-memory AuthService
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import { pathToFileURL } from "url";
import { ROOT } from "./helpers.mjs";

const AUTH_MOD = pathToFileURL(join(ROOT, "lib/saas/auth/auth-service.mjs")).href;
const COOKIE_MOD = pathToFileURL(join(ROOT, "lib/saas/auth/session-cookie.mjs")).href;
const SAAS_MOD = pathToFileURL(join(ROOT, "lib/saas/saas-container.mjs")).href;
const GUARD_MOD = pathToFileURL(join(ROOT, "lib/saas/auth/access-guard.mjs")).href;

describe("api v1 auth (in-memory)", () => {
  /** @type {import('../lib/saas/auth/auth-service.mjs').AuthService} */
  let auth;
  let extractSessionToken;
  let AccessGuard;
  let ForbiddenError;

  before(async () => {
    const authMod = await import(AUTH_MOD);
    const cookieMod = await import(COOKIE_MOD);
    const guardMod = await import(GUARD_MOD);
    auth = new authMod.AuthService(); // no userStore → Maps
    extractSessionToken = cookieMod.extractSessionToken;
    AccessGuard = guardMod.AccessGuard;
    ForbiddenError = guardMod.ForbiddenError;
  });

  it("signup + login + me round-trip", async () => {
    await auth.ensureDefaultTenant();
    const email = `student_${Date.now()}@example.com`;
    const password = "Password123!";
    const reg = await auth.signup({ name: "Test Student", email, password });
    assert.ok(reg.user.id);
    assert.equal(reg.user.tenantId, "default");

    const login = await auth.authenticateUser(email, password, "default");
    assert.ok(login.token.startsWith("sess_"));

    const verified = await auth.verifyToken(login.token);
    assert.equal(verified.userId, reg.user.id);
    const me = await auth.getUserForAuth(verified);
    assert.equal(me.email, email);
  });

  it("two users have isolated identities", async () => {
    await auth.ensureDefaultTenant();
    const a = await auth.signup({
      name: "User A",
      email: `a_${Date.now()}@example.com`,
      password: "Password123!",
    });
    const b = await auth.signup({
      name: "User B",
      email: `b_${Date.now()}@example.com`,
      password: "Password123!",
    });
    assert.notEqual(a.user.id, b.user.id);

    const loginA = await auth.authenticateUser(a.user.email, "Password123!", "default");
    const authA = await auth.verifyToken(loginA.token);
    const meA = await auth.getUserForAuth(authA);
    assert.equal(meA.id, a.user.id);
    assert.notEqual(meA.id, b.user.id);
  });

  it("extractSessionToken reads Bearer and cookie", () => {
    const token = "sess_abc123";
    assert.equal(extractSessionToken(null, `Bearer ${token}`), token);
    assert.equal(extractSessionToken(`sc_session=${encodeURIComponent(token)}; Path=/`, null), token);
    assert.equal(extractSessionToken(null, null), null);
  });

  it("unauthenticated verifyToken throws", async () => {
    await assert.rejects(() => auth.verifyToken(""), /required|Invalid|expired/i);
    await assert.rejects(() => auth.verifyToken("sess_bogus"), /Invalid|expired/i);
  });

  it("AccessGuard blocks cross-user profile access (403)", () => {
    const caller = { userId: "usr_a", tenantId: "default", role: "student" };
    const other = { userId: "usr_b", tenantId: "default" };
    assert.throws(() => AccessGuard.canAccessProfile(caller, other), ForbiddenError);
  });
});

describe("api v1 http smoke with isolated container", () => {
  it("POST signup/login/me via lightweight handler", async () => {
    const { SaaSContainer } = await import(SAAS_MOD);
    const { extractSessionToken, buildSessionCookie } = await import(COOKIE_MOD);
    const container = new SaaSContainer({ databaseUrl: null });
    await container.authService.ensureDefaultTenant();

    const email = `http_${Date.now()}@example.com`;
    const password = "Password123!";

    const signup = await container.authService.signup({ name: "Http User", email, password });
    const login = await container.authService.authenticateUser(email, password, "default");
    assert.ok(signup.user.id);
    assert.ok(login.token);

    const cookie = buildSessionCookie(login.token, { expiresAt: login.expiresAt });
    const token = extractSessionToken(cookie, null);
    assert.equal(token, login.token);

    const auth = await container.authService.verifyToken(token);
    const me = await container.authService.getUserForAuth(auth);
    assert.equal(me.email, email);

    // Ensure no mock opportunities leak
    const opps = await container.opportunityRepository.findByFilters({}, {
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    assert.equal(opps.length, 0);
  });
});
