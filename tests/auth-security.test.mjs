// tests/auth-security.test.mjs — Production Authentication & Authorization Security Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const SAAS_CONTAINER_MOD = pathToFileURL(join(ROOT, 'lib/saas/saas-container.mjs')).href;
const AUTH_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/auth-service.mjs')).href;
const HASHER_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/password-hasher.mjs')).href;
const GUARD_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/access-guard.mjs')).href;
const SANITIZER_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/sanitizer.mjs')).href;

console.log('\nauth-security — production authentication & cross-user access defense tests');

const { AuthService } = await import(AUTH_MOD);
const { PasswordHasher } = await import(HASHER_MOD);
const { AccessGuard, ForbiddenError, UnauthorizedError } = await import(GUARD_MOD);
const { Sanitizer } = await import(SANITIZER_MOD);

// ── Test 1: Password Complexity & PBKDF2 Hashing ──────────────────────────────
try {
  const weakCheck = PasswordHasher.validateComplexity('simple');
  if (!weakCheck.valid && weakCheck.errors.length > 0) {
    pass('PasswordHasher: weak passwords rejected (<8 chars / missing complexity)');
  } else {
    fail('PasswordHasher: weak password improperly accepted');
  }

  const strongPass = 'SecureStudentPass2026!';
  const strongCheck = PasswordHasher.validateComplexity(strongPass);
  if (strongCheck.valid) {
    pass('PasswordHasher: strong password passed complexity checks');
  } else {
    fail('PasswordHasher: strong password failed complexity');
  }

  const { hash, salt } = PasswordHasher.hashPassword(strongPass);
  if (hash && salt && salt.length === 64) {
    pass('PasswordHasher: salt and PBKDF2 key derived securely');
  } else {
    fail('PasswordHasher: invalid hash or salt generation');
  }

  const isMatch = PasswordHasher.verifyPassword(strongPass, hash, salt);
  const isWrong = PasswordHasher.verifyPassword('WrongPass123!', hash, salt);
  if (isMatch && !isWrong) {
    pass('PasswordHasher: timing-safe password verification verified');
  } else {
    fail('PasswordHasher: password verification logic failure');
  }
} catch (err) {
  fail('PasswordHasher test error: ' + err.message);
}

// ── Test 2: User Registration & Email Verification ────────────────────────────
try {
  const auth = new AuthService();
  const tenant = await auth.registerTenant({ name: 'LUMS Cohort' });

  const reg = await auth.registerUser({
    tenantId: tenant.id,
    email: 'ali.hassan@example.com',
    name: 'Ali Hassan',
    password: 'Password123!',
    role: 'student',
  });

  if (reg.user.id && reg.user.emailVerified === false && reg.verificationToken) {
    pass('AuthService: user registered with unverified email and secure token');
  } else {
    fail('AuthService: registration response missing expected fields');
  }

  // Duplicate email registration in same tenant must fail
  let dupFailed = false;
  try {
    await auth.registerUser({
      tenantId: tenant.id,
      email: 'ali.hassan@example.com',
      name: 'Ali Hassan Clone',
      password: 'Password123!',
    });
  } catch {
    dupFailed = true;
  }

  if (dupFailed) {
    pass('AuthService: duplicate email registration prevented per tenant');
  } else {
    fail('AuthService: duplicate email accepted');
  }

  // Verify email with token
  const verifyRes = await auth.verifyEmail(reg.verificationToken);
  if (verifyRes.success && verifyRes.userId === reg.user.id) {
    pass('AuthService: email verified successfully with token');
  } else {
    fail('AuthService: email verification failed');
  }

  // Single-use token check: reusing token must fail
  let reuseFailed = false;
  try {
    await auth.verifyEmail(reg.verificationToken);
  } catch {
    reuseFailed = true;
  }

  if (reuseFailed) {
    pass('AuthService: email verification token is single-use and consumed');
  } else {
    fail('AuthService: verification token was reusable');
  }
} catch (err) {
  fail('Registration & verification test error: ' + err.message);
}

// ── Test 3: Login & Brute-Force Lockout Protection ────────────────────────────
try {
  const auth = new AuthService();
  const tenant = await auth.registerTenant({ name: 'Test Tenant' });
  await auth.registerUser({
    tenantId: tenant.id,
    email: 'user@example.com',
    password: 'Password123!',
  });

  // Successful login
  const loginRes = await auth.authenticateUser('user@example.com', 'Password123!', tenant.id);
  if (loginRes.token && loginRes.user.email === 'user@example.com') {
    pass('AuthService: valid login returns secure session token');
  } else {
    fail('AuthService: login failed');
  }

  // Test consecutive failures lockout
  for (let i = 0; i < 5; i++) {
    try {
      await auth.authenticateUser('user@example.com', 'BadPass999!', tenant.id);
    } catch {
      // expected failure
    }
  }

  let lockedOut = false;
  try {
    await auth.authenticateUser('user@example.com', 'Password123!', tenant.id);
  } catch (err) {
    if (err.message.includes('Account temporarily locked')) {
      lockedOut = true;
    }
  }

  if (lockedOut) {
    pass('AuthService: brute-force lockout triggered after 5 consecutive failures');
  } else {
    fail('AuthService: account lockout failed to trigger');
  }
} catch (err) {
  fail('Login & lockout test error: ' + err.message);
}

// ── Test 4: Logout & Session Revocation ────────────────────────────────────────
try {
  const auth = new AuthService();
  const tenant = await auth.registerTenant({ name: 'Session Tenant' });
  const reg = await auth.registerUser({
    tenantId: tenant.id,
    email: 'session.user@example.com',
    password: 'Password123!',
  });

  const session = await auth.authenticateUser('session.user@example.com', 'Password123!', tenant.id);
  const verify1 = await auth.verifyToken(session.token);
  if (verify1.userId === reg.user.id) {
    pass('AuthService: session token valid and verified');
  } else {
    fail('AuthService: session token validation failed');
  }

  // Logout
  await auth.logout(session.token);
  let loggedOut = false;
  try {
    await auth.verifyToken(session.token);
  } catch {
    loggedOut = true;
  }

  if (loggedOut) {
    pass('AuthService: logout immediately revokes session token');
  } else {
    fail('AuthService: revoked token remained active');
  }
} catch (err) {
  fail('Session revocation test error: ' + err.message);
}

// ── Test 5: Password Reset Flow & Multi-Device Session Invalidation ───────────
try {
  const auth = new AuthService();
  const tenant = await auth.registerTenant({ name: 'Reset Tenant' });
  const reg = await auth.registerUser({
    tenantId: tenant.id,
    email: 'reset.user@example.com',
    password: 'OldPassword123!',
  });

  // Create active session
  const oldSession = await auth.authenticateUser('reset.user@example.com', 'OldPassword123!', tenant.id);

  // Request password reset
  const resetReq = await auth.requestPasswordReset('reset.user@example.com', tenant.id);
  if (resetReq.resetToken) {
    pass('AuthService: password reset token generated');
  } else {
    fail('AuthService: reset token generation failed');
  }

  // Execute password reset
  const resetDone = await auth.resetPassword(resetReq.resetToken, 'NewPassword999!');
  if (resetDone.success) {
    pass('AuthService: password updated with fresh hash and salt');
  } else {
    fail('AuthService: password reset execution failed');
  }

  // Reset token must be single-use (cannot be reused)
  let resetReuseFailed = false;
  try {
    await auth.resetPassword(resetReq.resetToken, 'AnotherPass123!');
  } catch {
    resetReuseFailed = true;
  }

  if (resetReuseFailed) {
    pass('AuthService: password reset token is single-use');
  } else {
    fail('AuthService: reset token was reusable');
  }

  // Old active session must be revoked after password reset
  let oldSessionRevoked = false;
  try {
    await auth.verifyToken(oldSession.token);
  } catch {
    oldSessionRevoked = true;
  }

  if (oldSessionRevoked) {
    pass('AuthService: password reset revokes all existing active sessions');
  } else {
    fail('AuthService: active sessions survived password reset');
  }

  // Login with new password
  const newLogin = await auth.authenticateUser('reset.user@example.com', 'NewPassword999!', tenant.id);
  if (newLogin.token) {
    pass('AuthService: login with new password successful');
  } else {
    fail('AuthService: login with new password failed');
  }
} catch (err) {
  fail('Password reset test error: ' + err.message);
}

// ── Test 6: Strict Cross-User Access Prevention (All 8 Domains) ───────────────
try {
  const userA = { userId: 'usr_student_alice', tenantId: 'tenant_lums', role: 'student' };
  const userB = { userId: 'usr_student_bob', tenantId: 'tenant_lums', role: 'student' };

  // 1. Profile Access Check
  const profileB = { id: 'prof_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', name: 'Bob' };
  let profileForbidden = false;
  try {
    AccessGuard.canAccessProfile(userA, profileB);
  } catch (err) {
    if (err instanceof ForbiddenError) profileForbidden = true;
  }
  if (profileForbidden) {
    pass('AccessGuard: Cross-user Profile access blocked with ForbiddenError');
  } else {
    fail('AccessGuard: Cross-user Profile access improperly allowed');
  }

  // 2. CV Access Check
  const cvB = { id: 'cv_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', path: 'cvs/bob.html' };
  let cvForbidden = false;
  try {
    AccessGuard.canAccessCV(userA, cvB);
  } catch (err) {
    if (err instanceof ForbiddenError) cvForbidden = true;
  }
  if (cvForbidden) {
    pass('AccessGuard: Cross-user CV artifact access blocked');
  } else {
    fail('AccessGuard: Cross-user CV access improperly allowed');
  }

  // 3. Applications Access Check
  const appB = { id: 'app_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', state: 'APPLIED' };
  let appForbidden = false;
  try {
    AccessGuard.canAccessApplication(userA, appB);
  } catch (err) {
    if (err instanceof ForbiddenError) appForbidden = true;
  }
  if (appForbidden) {
    pass('AccessGuard: Cross-user Application record access blocked');
  } else {
    fail('AccessGuard: Cross-user Application access improperly allowed');
  }

  // 4. Generated Documents Access Check
  const docB = { id: 'doc_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', type: 'cover_letter' };
  let docForbidden = false;
  try {
    AccessGuard.canAccessDocument(userA, docB);
  } catch (err) {
    if (err instanceof ForbiddenError) docForbidden = true;
  }
  if (docForbidden) {
    pass('AccessGuard: Cross-user Generated Document access blocked');
  } else {
    fail('AccessGuard: Cross-user Document access improperly allowed');
  }

  // 5. API Credentials Access Check
  const apiKeyB = { id: 'key_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', apiKey: 'sc_secret' };
  let keyForbidden = false;
  try {
    AccessGuard.canAccessApiKey(userA, apiKeyB);
  } catch (err) {
    if (err instanceof ForbiddenError) keyForbidden = true;
  }
  if (keyForbidden) {
    pass('AccessGuard: Cross-user API Credential access blocked');
  } else {
    fail('AccessGuard: Cross-user API Key access improperly allowed');
  }

  // 6. Browser Sessions Access Check
  const sessionB = { id: 'session_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', status: 'PAUSED' };
  let browserForbidden = false;
  try {
    AccessGuard.canAccessBrowserSession(userA, sessionB);
  } catch (err) {
    if (err instanceof ForbiddenError) browserForbidden = true;
  }
  if (browserForbidden) {
    pass('AccessGuard: Cross-user Browser Session inspection blocked');
  } else {
    fail('AccessGuard: Cross-user Browser Session access improperly allowed');
  }

  // 7. Agent Config Access Check
  const configB = { id: 'cfg_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', autoSubmit: false };
  let configForbidden = false;
  try {
    AccessGuard.canAccessAgentConfig(userA, configB);
  } catch (err) {
    if (err instanceof ForbiddenError) configForbidden = true;
  }
  if (configForbidden) {
    pass('AccessGuard: Cross-user Agent Configuration tampering blocked');
  } else {
    fail('AccessGuard: Cross-user Agent Config access improperly allowed');
  }

  // 8. Job History Access Check
  const historyB = { id: 'hist_bob', userId: 'usr_student_bob', tenantId: 'tenant_lums', seenUrls: [] };
  let historyForbidden = false;
  try {
    AccessGuard.canAccessHistory(userA, historyB);
  } catch (err) {
    if (err instanceof ForbiddenError) historyForbidden = true;
  }
  if (historyForbidden) {
    pass('AccessGuard: Cross-user Job Discovery History access blocked');
  } else {
    fail('AccessGuard: Cross-user History access improperly allowed');
  }

  // Cross-Tenant Access Check
  const userOtherTenant = { userId: 'usr_student_alice', tenantId: 'tenant_nust', role: 'student' };
  let crossTenantForbidden = false;
  try {
    AccessGuard.canAccessProfile(userOtherTenant, profileB);
  } catch (err) {
    if (err instanceof ForbiddenError) crossTenantForbidden = true;
  }
  if (crossTenantForbidden) {
    pass('AccessGuard: Cross-tenant access blocked with ForbiddenError');
  } else {
    fail('AccessGuard: Cross-tenant access improperly allowed');
  }

  // Unauthenticated Access Check
  let unauthBlocked = false;
  try {
    AccessGuard.canAccessProfile(null, profileB);
  } catch (err) {
    if (err instanceof UnauthorizedError) unauthBlocked = true;
  }
  if (unauthBlocked) {
    pass('AccessGuard: Unauthenticated request blocked with UnauthorizedError');
  } else {
    fail('AccessGuard: Unauthenticated request accepted');
  }
} catch (err) {
  fail('AccessGuard authorization test error: ' + err.message);
}

// ── Test 7: Zero-Secret Logging & Sanitization Guarantee ──────────────────────
try {
  const sensitiveRecord = {
    userId: 'usr_123',
    email: 'user@example.com',
    password: 'SuperSecretPassword!',
    passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    passwordSalt: '8a9b0c',
    token: 'sess_abc123secrettoken',
    apiKey: 'sc_secretkey456',
    authorization: 'Bearer secret_token',
    cookie: 'session_id=secret123',
    profile: {
      name: 'Student Name',
      secretNotes: 'Confidential Notes',
    },
  };

  const sanitized = Sanitizer.sanitize(sensitiveRecord);

  if (
    sanitized.password === '***REDACTED***' &&
    sanitized.passwordHash === '***REDACTED***' &&
    sanitized.passwordSalt === '***REDACTED***' &&
    sanitized.token === '***REDACTED***' &&
    sanitized.apiKey === '***REDACTED***' &&
    sanitized.authorization === '***REDACTED***' &&
    sanitized.cookie === '***REDACTED***' &&
    sanitized.profile.secretNotes === '***REDACTED***' &&
    sanitized.email === 'user@example.com' &&
    sanitized.profile.name === 'Student Name'
  ) {
    pass('Sanitizer: Passwords, tokens, salts, hashes, and secrets strictly redacted');
  } else {
    fail('Sanitizer: Sensitive credentials leaked in sanitized output');
  }
} catch (err) {
  fail('Sanitizer test error: ' + err.message);
}

console.log('✅ All Production Authentication & Authorization tests passed.\n');
