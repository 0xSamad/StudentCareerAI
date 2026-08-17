// tests/multi-user-isolation.test.mjs — User A cannot read User B resources
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import { pathToFileURL } from "url";
import { ROOT } from "./helpers.mjs";

const AUTH_MOD = pathToFileURL(join(ROOT, "lib/saas/auth/auth-service.mjs")).href;
const GUARD_MOD = pathToFileURL(join(ROOT, "lib/saas/auth/access-guard.mjs")).href;
const DB_MOD = pathToFileURL(join(ROOT, "lib/saas/database/tenant-repository.mjs")).href;

describe("multi-user isolation", () => {
  let auth;
  let AccessGuard;
  let ForbiddenError;
  let UnauthorizedError;
  let profileRepo;
  let appRepo;

  before(async () => {
    const authMod = await import(AUTH_MOD);
    const guardMod = await import(GUARD_MOD);
    const dbMod = await import(DB_MOD);
    auth = new authMod.AuthService();
    AccessGuard = guardMod.AccessGuard;
    ForbiddenError = guardMod.ForbiddenError;
    UnauthorizedError = guardMod.UnauthorizedError;
    profileRepo = new dbMod.TenantStudentProfileRepository();
    appRepo = new dbMod.TenantApplicationRepository();
  });

  it("User A cannot read User B profile via AccessGuard + repository", async () => {
    await auth.ensureDefaultTenant();
    const a = await auth.signup({
      name: "Alice",
      email: `alice_${Date.now()}@example.com`,
      password: "Password123!",
    });
    const b = await auth.signup({
      name: "Bob",
      email: `bob_${Date.now()}@example.com`,
      password: "Password123!",
    });

    await profileRepo.upsertProfile(a.user.id, a.user.tenantId, {
      identity: { name: "Alice" },
    });
    await profileRepo.upsertProfile(b.user.id, b.user.tenantId, {
      identity: { name: "Bob Secret" },
    });

    const profileB = await profileRepo.getByUserId(b.user.id, b.user.tenantId);
    assert.ok(profileB);

    const ctxA = { userId: a.user.id, tenantId: a.user.tenantId, role: "student" };
    assert.throws(() => AccessGuard.canAccessProfile(ctxA, profileB), ForbiddenError);

    // Correct owner can access
    const ctxB = { userId: b.user.id, tenantId: b.user.tenantId, role: "student" };
    assert.equal(AccessGuard.canAccessProfile(ctxB, profileB), true);

    // Cross-user repository lookup returns null (wrong tenant/user key)
    const leak = await profileRepo.getByUserId(b.user.id, "other_tenant");
    assert.equal(leak, null);
  });

  it("User A cannot read User B applications", async () => {
    await auth.ensureDefaultTenant();
    const a = await auth.signup({
      name: "A2",
      email: `a2_${Date.now()}@example.com`,
      password: "Password123!",
    });
    const b = await auth.signup({
      name: "B2",
      email: `b2_${Date.now()}@example.com`,
      password: "Password123!",
    });

    await appRepo.create(
      { opportunity_id: "opp_secret", company: "SecretCo", title: "Intern", state: "APPLIED" },
      { tenantId: b.user.tenantId, userId: b.user.id }
    );

    const appsA = await appRepo.findMany({}, { tenantId: a.user.tenantId, userId: a.user.id });
    assert.equal(appsA.length, 0);

    const appsB = await appRepo.findMany({}, { tenantId: b.user.tenantId, userId: b.user.id });
    assert.equal(appsB.length, 1);

    const ctxA = { userId: a.user.id, tenantId: a.user.tenantId, role: "student" };
    assert.throws(() => AccessGuard.canAccessApplication(ctxA, appsB[0]), ForbiddenError);
  });

  it("missing auth context is Unauthorized", () => {
    assert.throws(
      () => AccessGuard.assertAccess(null, { userId: "x", tenantId: "t" }, "resource"),
      UnauthorizedError
    );
  });
});
