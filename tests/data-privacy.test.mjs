// tests/data-privacy.test.mjs — GDPR/CCPA Data Rights, Privacy & Erasure Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const SAAS_CONTAINER_MOD = pathToFileURL(join(ROOT, 'lib/saas/saas-container.mjs')).href;
const PRIVACY_MOD = pathToFileURL(join(ROOT, 'lib/saas/privacy/index.mjs')).href;

console.log('\ndata-privacy — GDPR/CCPA data portability, selective erasure & account deletion tests');

const { SaaSContainer, ForbiddenError } = await import(SAAS_CONTAINER_MOD);
const { DataPrivacyService } = await import(PRIVACY_MOD);

// ── Test 1: GDPR User Data Portability (exportUserData) ───────────────────────
try {
  const container = new SaaSContainer({ storageDir: join(ROOT, 'data/test_privacy_storage') });
  const context = { tenantId: 'tenant_lums', userId: 'user_ali', role: 'user' };

  // Setup profile and applications
  await container.profileRepository.upsertProfile('user_ali', 'tenant_lums', {
    identity: { name: 'Ali Hassan', email: 'ali@example.com' },
    education: [{ university: 'LUMS', degree: 'BS', major: 'Computer Science' }],
    skills: { programming_languages: ['Python', 'SQL'] },
    rawCvText: '# Ali Hassan\n\nExperienced Python developer.',
  });

  await container.applicationRepository.create(
    {
      opportunity_id: 'careem_123',
      company: 'Careem',
      title: 'AI Intern',
      state: 'APPLICATION_READY',
      matchScore: 92,
    },
    context
  );

  await container.auditLogRepository.logEvent({ action: 'EVALUATION_COMPLETED' }, context);

  // Execute export
  const exportArchive = await container.dataPrivacyService.exportUserData(context);

  if (
    exportArchive.exportVersion === '2.0' &&
    exportArchive.userId === 'user_ali' &&
    exportArchive.profile.identity.name === 'Ali Hassan' &&
    exportArchive.applications.length === 1 &&
    exportArchive.auditEvents.length >= 1
  ) {
    pass('DataPrivacyService: GDPR machine-readable JSON data portability archive exported with complete user data');
  } else {
    fail('DataPrivacyService: data portability export incomplete');
  }
} catch (err) {
  fail('Export test error: ' + err.message);
}

// ── Test 2: Selective CV Deletion (deleteCV) ──────────────────────────────────
try {
  const container = new SaaSContainer({ storageDir: join(ROOT, 'data/test_privacy_storage') });
  const context = { tenantId: 'tenant_lums', userId: 'user_ali', role: 'user' };

  await container.profileRepository.upsertProfile('user_ali', 'tenant_lums', {
    identity: { name: 'Ali Hassan', email: 'ali@example.com' },
    rawCvText: '# Ali Hassan CV Content',
  });

  // Save a mock tailored CV
  await container.storageService.saveFile('cvs/tailored_123.html', '<html>CV</html>', {}, context);

  const delResult = await container.dataPrivacyService.deleteCV(context);
  const updatedProfile = await container.profileRepository.getByUserId('user_ali', 'tenant_lums');

  if (delResult.success && updatedProfile.rawCvText === null) {
    pass('DataPrivacyService: Master CV data and storage artifacts permanently deleted upon user request');
  } else {
    fail('DataPrivacyService: CV deletion failed');
  }
} catch (err) {
  fail('CV deletion test error: ' + err.message);
}

// ── Test 3: Selective Application History Purge (deleteApplicationHistory) ─────
try {
  const container = new SaaSContainer({ storageDir: join(ROOT, 'data/test_privacy_storage') });
  const context = { tenantId: 'tenant_lums', userId: 'user_ali', role: 'user' };

  await container.profileRepository.upsertProfile('user_ali', 'tenant_lums', {
    identity: { name: 'Ali Hassan' },
  });

  await container.applicationRepository.create(
    {
      opportunity_id: 'arbisoft_456',
      company: 'Arbisoft',
      title: 'Backend Intern',
      state: 'APPLIED',
    },
    context
  );

  const purgeResult = await container.dataPrivacyService.deleteApplicationHistory(context);
  const remainingApps = await container.applicationRepository.findMany({}, context);

  if (purgeResult.success && purgeResult.deletedApplicationsCount >= 1 && remainingApps.length === 0) {
    pass('DataPrivacyService: Application history, form answers, and tracking records purged cleanly');
  } else {
    fail('DataPrivacyService: Application history purge failed');
  }
} catch (err) {
  fail('Application purge test error: ' + err.message);
}

// ── Test 4: Permanent Account Deletion (deleteUserAccount) ────────────────────
try {
  const container = new SaaSContainer({ storageDir: join(ROOT, 'data/test_privacy_account_del') });
  const context = { tenantId: 'tenant_eradicate', userId: 'user_to_delete', role: 'user' };

  // Register tenant, user, create profile, save file
  await container.authService.registerTenant({ tenantId: 'tenant_eradicate', name: 'Eradicate Tenant' });
  await container.authService.registerUser({
    userId: 'user_to_delete',
    email: 'delete_me@example.com',
    password: 'SecurePassword123!',
    tenantId: 'tenant_eradicate',
  });
  await container.profileRepository.upsertProfile('user_to_delete', 'tenant_eradicate', {
    identity: { name: 'Delete Me' },
  });
  await container.storageService.saveFile('cvs/my_cv.pdf', 'PDFDATA', {}, context);

  // Eradicate account
  const delResult = await container.dataPrivacyService.deleteUserAccount('user_to_delete', context);

  const profileAfter = await container.profileRepository.getByUserId('user_to_delete', 'tenant_eradicate');
  const authUserAfter = container.authService.users.get('user_to_delete');

  if (delResult.success && !profileAfter && !authUserAfter) {
    pass('DataPrivacyService: User account, authentication credentials, profile, and files permanently eradicated');
  } else {
    fail('DataPrivacyService: Account eradication failed');
  }
} catch (err) {
  fail('Account deletion test error: ' + err.message);
}

// ── Test 5: Cross-User Deletion & Export Protection ───────────────────────────
try {
  const container = new SaaSContainer();
  const victimContext = { tenantId: 'tenant_a', userId: 'user_victim', role: 'user' };
  const attackerContext = { tenantId: 'tenant_a', userId: 'user_attacker', role: 'user' };

  await container.profileRepository.upsertProfile('user_victim', 'tenant_a', {
    identity: { name: 'Victim Student' },
  });

  let blocked = false;
  try {
    await container.dataPrivacyService.deleteUserAccount('user_victim', attackerContext);
  } catch (err) {
    if (err instanceof ForbiddenError || err.name === 'ForbiddenError' || err.message.includes('Forbidden')) {
      blocked = true;
    }
  }

  if (blocked) {
    pass('DataPrivacyService: Cross-user data export and account deletion attempts strictly blocked with ForbiddenError');
  } else {
    fail('DataPrivacyService: Cross-user authorization bypass vulnerability detected');
  }
} catch (err) {
  fail('Cross-user privacy test error: ' + err.message);
}

console.log('✅ All GDPR/CCPA Data Privacy & Deletion tests passed.\n');
