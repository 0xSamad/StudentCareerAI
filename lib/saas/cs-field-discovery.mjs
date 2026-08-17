/**
 * cs-field-discovery.mjs — Detect computer-science / tech roles for open discovery mode.
 */

const CS_TITLE =
  /\b(software|developer|engineer|programming|programmer|computer science|\bcs\b|information technology|\bit\b|data scientist|data analyst|data engineer|machine learning|\bml\b| artificial intelligence|\bai\b|backend|front[-\s]?end|full[-\s]?stack|devops|sre|site reliability|cloud engineer|platform engineer|cyber|security engineer|network engineer|mobile developer|android|ios|web developer|qa engineer|test engineer|intern|internship|co-op|trainee|apprentice|new grad|graduate|entry[-\s]?level|associate.*engineer|engineer.*intern)\b/i;

const NON_CS =
  /\b(account executive|sales|business development|recruiter|talent acquisition|human resources|\bhr\b|legal counsel|paralegal|finance manager|accountant|marketing manager|brand manager|customer support representative|call center|warehouse|driver|nurse|physician|auditor|tax analyst|compliance officer|real estate|property manager)\b/i;

/**
 * @param {string} title
 * @param {object} [profile]
 * @returns {boolean}
 */
export function isCsFieldRole(title = '', profile = {}) {
  const t = String(title || '').trim();
  if (!t || NON_CS.test(t)) return false;

  const education = Array.isArray(profile.education) ? profile.education : [];
  const fields = education
    .flatMap((e) => [e?.field, e?.major, e?.degree, e?.program].filter(Boolean))
    .join(' ');
  const prefField = profile.preferences?.field_of_study || profile.preferences?.major || '';
  const studyHaystack = `${fields} ${prefField}`.toLowerCase();

  const studyIsCs =
    /computer|software|information tech|data sci|artificial intelligence|machine learning|\bcs\b|\bit\b|electrical engineer|ece\b|stem/i.test(
      studyHaystack
    );

  if (studyIsCs || education.length === 0) {
    return CS_TITLE.test(t);
  }

  return CS_TITLE.test(t);
}

export function isInternshipTitle(title = '') {
  return /\b(interns?|internship|internships|co-ops?|trainee|apprentice|working student|werkstudent)\b/i.test(
    title || ''
  );
}

const SENIOR_TITLE =
  /\b(senior|staff|principal|lead|director|head of|vice president|\bvp\b|architect|manager)\b/i;

/**
 * Student / early-career CS roles that belong on the internships feed.
 * Excludes senior/staff/lead titles so Jobs still gets experienced roles.
 */
export function isStudentOpportunityTitle(title = '') {
  const t = String(title || '');
  if (!t.trim()) return false;
  if (SENIOR_TITLE.test(t)) return false;
  if (isInternshipTitle(t)) return true;
  return /\b(student|campus|university recruit|placement|graduate (program|scheme|role|engineer|developer|analyst)|new[- ]grad|early[- ]career|junior|associate (software|developer|engineer|analyst|data)|entry[- ]level)\b/i.test(
    t
  );
}

export function passesSearchMode(title, searchMode) {
  const intern = isStudentOpportunityTitle(title);
  if (searchMode === 'INTERNSHIP') return intern;
  if (searchMode === 'JOB') return !isInternshipTitle(title);
  return true;
}
