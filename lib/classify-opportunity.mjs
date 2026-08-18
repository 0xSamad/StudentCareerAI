/**
 * classify-opportunity.mjs — StudentCareer AI Opportunity Classification Engine
 *
 * Classifies every discovered opportunity into INTERNSHIP | JOB | OTHER.
 *
 * Design principles:
 *   - Multi-signal, not title-only: title, description, employment_type,
 *     experience requirements, student/education requirements, duration, and
 *     programme-wording all contribute weighted scores.
 *   - Evidence accumulation: every matched signal is recorded and returned
 *     in classification_reason so results are auditable.
 *   - No fabrication: when signals are absent the classifier says so.
 *   - Pure function: no I/O, no side-effects, deterministic.
 *   - Language-aware: matches English, German (Werkstudent, Praktikum),
 *     French (stagiaire), and common multilingual patterns.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {'INTERNSHIP'|'JOB'|'OTHER'} OpportunityType
 * @typedef {'HIGH'|'MEDIUM'|'LOW'} Confidence
 *
 * @typedef {Object} OpportunityInput
 * @property {string}  title
 * @property {string}  [description]
 * @property {string}  [employment_type]   e.g. "Full-time", "Internship", "Part-time"
 * @property {string}  [company]
 * @property {string}  [location]
 *
 * @typedef {Object} ClassificationResult
 * @property {OpportunityType} opportunity_type
 * @property {Confidence}      classification_confidence
 * @property {string}          classification_reason
 * @property {number}          _internship_score   Internal (useful for debugging)
 * @property {number}          _job_score          Internal
 */

// ── Confidence thresholds ─────────────────────────────────────────────────────

const CONFIDENCE_HIGH   = 0.72;   // winner's share of total weighted score
const CONFIDENCE_MEDIUM = 0.55;
const MIN_SIGNAL_SCORE  = 4;      // below this → OTHER (not enough evidence)

// ── Internship signal definitions ─────────────────────────────────────────────

/**
 * Each signal: { pattern, weight, label, source }
 * source: 'title' | 'description' | 'employment_type' | 'experience' | 'any'
 */
const INTERNSHIP_SIGNALS = [
  // ── Title signals (strongest evidence) ────────────────────────────────────
  { pattern: /\bintern(?:ship)?\b/i,                                   weight: 10, label: 'title contains "intern/internship"',            source: 'title' },
  { pattern: /\bco[-\s]?op\b/i,                                        weight: 10, label: 'title contains "co-op"',                        source: 'title' },
  { pattern: /\bprakti(?:kant|kum|kantin)\b/i,                         weight: 10, label: 'title contains German "Praktikum/Praktikant"',   source: 'title' },
  { pattern: /\bwerkstudent(?:in)?\b/i,                                weight: 10, label: 'title contains German "Werkstudent"',            source: 'title' },
  { pattern: /\bworking\s+student\b/i,                                  weight: 10, label: 'title contains "working student"',              source: 'title' },
  { pattern: /\bstudent\s+(?:worker|employee|researcher|developer|engineer|assistant)\b/i, weight: 9, label: 'title contains "student [role]"', source: 'title' },
  { pattern: /\bstagiaire\b/i,                                          weight: 10, label: 'title contains French "stagiaire"',             source: 'title' },
  { pattern: /\bapprentice(?:ship)?\b/i,                                weight: 8,  label: 'title contains "apprentice/apprenticeship"',    source: 'title' },
  { pattern: /\btrainee\b/i,                                            weight: 8,  label: 'title contains "trainee"',                      source: 'title' },
  { pattern: /\bpracticum\b/i,                                          weight: 8,  label: 'title contains "practicum"',                    source: 'title' },
  { pattern: /\bexternship\b/i,                                         weight: 9,  label: 'title contains "externship"',                   source: 'title' },
  { pattern: /\b(?:summer|winter|spring|fall)\s+(?:\d{4}\s+)?program\b/i, weight: 6, label: 'title contains seasonal program',             source: 'title' },
  { pattern: /\bgraduate\s+(?:program|rotational|scheme)\b/i,          weight: 6,  label: 'title contains graduate programme',              source: 'title' },

  // ── Employment type field ──────────────────────────────────────────────────
  { pattern: /\bintern(?:ship)?\b/i,                                   weight: 10, label: 'employment_type is internship',                  source: 'employment_type' },
  { pattern: /\bco[-\s]?op\b/i,                                        weight: 10, label: 'employment_type is co-op',                       source: 'employment_type' },
  { pattern: /\bapprentice(?:ship)?\b/i,                               weight: 9,  label: 'employment_type is apprenticeship',              source: 'employment_type' },
  { pattern: /\btemporary\b/i,                                         weight: 3,  label: 'employment_type is temporary',                   source: 'employment_type' },
  { pattern: /\bcontract\b/i,                                          weight: 2,  label: 'employment_type is contract',                    source: 'employment_type' },

  // ── Description: student status requirements ───────────────────────────────
  { pattern: /\bcurrently\s+enroll(?:ed|ment)\b/i,                     weight: 9,  label: 'requires current enrollment',                    source: 'description' },
  { pattern: /\bmust\s+be\s+(?:a\s+)?(?:current\s+)?(?:full[-\s]?time\s+)?student\b/i, weight: 9, label: 'requires being a student',        source: 'description' },
  { pattern: /\bpursuing\s+(?:a\s+)?(?:bachelor|master|phd|doctorate|degree|b\.s\.|m\.s\.|b\.eng)\b/i, weight: 8, label: 'pursuing a degree requirement', source: 'description' },
  { pattern: /\b(?:undergraduate|graduate)\s+student\b/i,              weight: 8,  label: 'description mentions undergraduate/graduate student', source: 'description' },
  { pattern: /\benrolled\s+in\s+(?:a\s+)?(?:bachelor|master|phd|college|university|accredited)\b/i, weight: 8, label: 'must be enrolled in degree programme', source: 'description' },
  { pattern: /\bstudent\s+(?:visa|status)\b/i,                         weight: 7,  label: 'mentions student visa/status',                   source: 'description' },
  { pattern: /\bexpected\s+graduation\b/i,                             weight: 8,  label: 'asks for expected graduation date',              source: 'description' },
  { pattern: /\bgraduat(?:ing|ion)\s+(?:in|class\s+of)\s+20\d\d\b/i,  weight: 7,  label: 'graduation year requirement',                    source: 'description' },

  // ── Description: GPA requirements (strong student signal) ─────────────────
  { pattern: /\b(?:minimum\s+)?gpa\s+(?:of\s+)?\d\.\d/i,              weight: 8,  label: 'GPA requirement in description',                 source: 'description' },
  { pattern: /\bgpa\s+requirement\b/i,                                  weight: 7,  label: 'mentions GPA requirement',                       source: 'description' },

  // ── Description: academic credit ───────────────────────────────────────────
  { pattern: /\bacademic\s+credit\b/i,                                  weight: 9,  label: 'offers academic credit',                         source: 'description' },
  { pattern: /\bcourse\s+credit\b/i,                                    weight: 9,  label: 'offers course credit',                           source: 'description' },
  { pattern: /\bcredit[-\s]bearing\b/i,                                 weight: 9,  label: 'credit-bearing position',                        source: 'description' },

  // ── Description: stipend (not salary) ─────────────────────────────────────
  { pattern: /\bstipend\b/i,                                            weight: 6,  label: 'mentions stipend (intern compensation)',          source: 'description' },
  { pattern: /\bhourly\s+(?:rate|pay|wage)\b/i,                        weight: 3,  label: 'mentions hourly pay',                            source: 'description' },

  // ── Description: programme/duration wording ───────────────────────────────
  { pattern: /\b(?:summer|winter|spring|fall)\s+(?:20\d\d\s+)?(?:intern(?:ship)?|program|cohort)\b/i, weight: 7, label: 'seasonal internship programme', source: 'description' },
  { pattern: /\b\d+[-\s](?:to[-\s])?\d*\s*(?:month|week)s?\s+(?:position|role|internship|contract|program|assignment)\b/i, weight: 6, label: 'fixed short-term duration', source: 'description' },
  { pattern: /\brotation(?:al)?\s+program\b/i,                         weight: 7,  label: 'rotational programme',                           source: 'description' },
  { pattern: /\bco[-\s]?op\s+program\b/i,                              weight: 9,  label: 'co-op programme in description',                  source: 'description' },
  { pattern: /\bsummer\s+20\d\d\b/i,                                   weight: 5,  label: 'specific summer year mentioned',                  source: 'description' },
  { pattern: /\b12[-\s]week\b/i,                                       weight: 6,  label: '12-week duration (typical intern)',                source: 'description' },
  { pattern: /\b(?:10|11|12|13|14|15|16)\s+weeks?\b/i,                 weight: 5,  label: 'short-term week duration',                        source: 'description' },

  // ── Description: German/multilingual ──────────────────────────────────────
  { pattern: /\bpraktikum\b/i,                                         weight: 10, label: 'German Praktikum in description',                 source: 'description' },
  { pattern: /\bwerkstudent(?:stelle|in)?\b/i,                         weight: 10, label: 'German Werkstudent in description',               source: 'description' },

  // ── Description: experience requirements (0-1 year → intern signal) ───────
  { pattern: /\b0[-–](?:1|2)\s+years?\s+(?:of\s+)?experience\b/i,     weight: 4,  label: '0–2 years experience required',                  source: 'description' },
  { pattern: /\bno\s+(?:prior\s+)?(?:professional\s+)?experience\s+(?:is\s+)?required\b/i, weight: 5, label: 'no experience required',      source: 'description' },
  { pattern: /\bentry[-\s]level\b/i,                                   weight: 2,  label: 'entry-level (weak intern signal)',                source: 'description' },
];

// ── Job signal definitions ────────────────────────────────────────────────────

const JOB_SIGNALS = [
  // ── Title: seniority markers ───────────────────────────────────────────────
  { pattern: /\b(?:senior|sr\.?)\s/i,                                  weight: 8,  label: 'title has senior/sr seniority',                  source: 'title' },
  { pattern: /\b(?:lead|staff|principal|distinguished)\s/i,             weight: 8,  label: 'title has lead/staff/principal level',           source: 'title' },
  { pattern: /\b(?:director|vp|vice\s+president|head\s+of|cto|cpo|ceo|cmo|cso)\b/i, weight: 9, label: 'title has director/executive level', source: 'title' },
  { pattern: /\bmanager\b/i,                                            weight: 7,  label: 'title contains "manager"',                       source: 'title' },
  { pattern: /\b(?:mid[-\s]?level|mid[-\s]senior)\b/i,                 weight: 6,  label: 'title has mid-level seniority',                  source: 'title' },
  { pattern: /\b(?:full[-\s]?time|permanent)\b/i,                      weight: 5,  label: 'title says full-time/permanent',                  source: 'title' },

  // ── Employment type field ──────────────────────────────────────────────────
  { pattern: /\bfull[-\s]?time\b/i,                                    weight: 8,  label: 'employment_type is full-time',                   source: 'employment_type' },
  { pattern: /\bpermanent\b/i,                                         weight: 8,  label: 'employment_type is permanent',                   source: 'employment_type' },
  { pattern: /\bdirect\s+hire\b/i,                                     weight: 7,  label: 'employment_type is direct hire',                 source: 'employment_type' },

  // ── Description: years of experience ──────────────────────────────────────
  { pattern: /\b[2-9]\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|industry\s+)?experience\b/i, weight: 9, label: '2+ years professional experience required', source: 'description' },
  { pattern: /\b(?:1[0-9]|[2-9])\+?\s+years?\b/i,                     weight: 10, label: '2+ years experience requirement',                source: 'description' },
  { pattern: /\bminimum\s+[2-9]\s+years?\b/i,                         weight: 9,  label: 'minimum 2+ years experience',                    source: 'description' },
  { pattern: /\b[3-9]\s+to\s+[5-9]\s+years?\b/i,                      weight: 9,  label: 'multi-year experience range',                    source: 'description' },

  // ── Description: compensation (salary not stipend) ────────────────────────
  { pattern: /\bcompetitive\s+salary\b/i,                               weight: 5,  label: 'mentions competitive salary',                    source: 'description' },
  { pattern: /\b401[kK]\b/i,                                           weight: 7,  label: 'mentions 401k (US full-time benefit)',            source: 'description' },
  { pattern: /\bhealth\s+(?:insurance|benefits)\b/i,                   weight: 5,  label: 'mentions health insurance',                      source: 'description' },
  { pattern: /\bstock\s+options?\b/i,                                   weight: 4,  label: 'mentions stock options',                         source: 'description' },
  { pattern: /\bequity\b/i,                                             weight: 3,  label: 'mentions equity',                                source: 'description' },
  { pattern: /\brelocation\s+(?:assistance|package|support)\b/i,       weight: 6,  label: 'mentions relocation package',                    source: 'description' },
  { pattern: /\bbonus\s+(?:structure|plan|eligib)\b/i,                 weight: 4,  label: 'mentions bonus structure',                       source: 'description' },
  { pattern: /\bannual\s+(?:salary|compensation|base)\b/i,              weight: 5,  label: 'mentions annual salary',                         source: 'description' },

  // ── Description: permanent/full-time wording ──────────────────────────────
  { pattern: /\bfull[-\s]?time\s+(?:position|role|employee|employment|opportunity)\b/i, weight: 7, label: 'full-time position in description', source: 'description' },
  { pattern: /\bpermanent\s+(?:position|role|employment)\b/i,          weight: 7,  label: 'permanent position in description',               source: 'description' },
  { pattern: /\bindefinite\s+(?:term|contract)\b/i,                    weight: 6,  label: 'indefinite term contract',                        source: 'description' },

  // ── Description: professional prerequisites ────────────────────────────────
  { pattern: /\bproven\s+(?:track\s+record|experience)\b/i,            weight: 6,  label: 'requires proven track record',                   source: 'description' },
  { pattern: /\bproduction\s+experience\b/i,                           weight: 6,  label: 'requires production experience',                  source: 'description' },
  { pattern: /\bindustry\s+experience\b/i,                             weight: 5,  label: 'requires industry experience',                    source: 'description' },
  { pattern: /\b(?:previously|prior)\s+(?:worked?|employed|built|led|managed)\b/i, weight: 5, label: 'assumes prior professional work', source: 'description' },
];

// ── Other / ambiguous signals (flag but do not count for either side) ─────────

const OTHER_SIGNALS = [
  { pattern: /\bvolunteer\b/i,              label: 'volunteer position' },
  { pattern: /\bfreelance\b/i,             label: 'freelance position' },
  { pattern: /\bfellowship\b/i,            label: 'fellowship programme' },
  { pattern: /\bgrant\s+(?:funded|position)\b/i, label: 'grant-funded position' },
  { pattern: /\bpost[-\s]?doc(?:toral)?\b/i, label: 'postdoctoral position' },
  { pattern: /\bresearch\s+assistant\b/i,   label: 'research assistant (ambiguous)' },
];

// ── Core scorer ───────────────────────────────────────────────────────────────

/**
 * Score one signal set against a text string.
 * @param {typeof INTERNSHIP_SIGNALS} signals
 * @param {string} text
 * @param {string} source
 * @returns {{ score: number, matched: string[] }}
 */
function scoreSignals(signals, text, source) {
  let score = 0;
  const matched = [];
  for (const sig of signals) {
    if (sig.source !== source && sig.source !== 'any') continue;
    if (sig.pattern.test(text)) {
      score += sig.weight;
      matched.push(sig.label);
    }
  }
  return { score, matched };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a single opportunity.
 *
 * @param {OpportunityInput} opportunity
 * @returns {ClassificationResult}
 */
export function classifyOpportunity(opportunity) {
  const title       = String(opportunity.title       ?? '');
  const description = String(opportunity.description ?? '');
  const empType     = String(opportunity.employment_type ?? '');

  // ── Score across each source field ────────────────────────────────────────
  const internTitle = scoreSignals(INTERNSHIP_SIGNALS, title,       'title');
  const internDesc  = scoreSignals(INTERNSHIP_SIGNALS, description, 'description');
  const internEmp   = scoreSignals(INTERNSHIP_SIGNALS, empType,     'employment_type');

  const jobTitle    = scoreSignals(JOB_SIGNALS, title,       'title');
  const jobDesc     = scoreSignals(JOB_SIGNALS, description, 'description');
  const jobEmp      = scoreSignals(JOB_SIGNALS, empType,     'employment_type');

  const internScore = internTitle.score + internDesc.score + internEmp.score;
  const jobScore    = jobTitle.score    + jobDesc.score    + jobEmp.score;
  const totalScore  = internScore + jobScore;

  // ── OTHER signals (informational) ─────────────────────────────────────────
  const otherMatched = OTHER_SIGNALS
    .filter((s) => s.pattern.test(title) || s.pattern.test(description))
    .map((s) => s.label);

  // ── Determine type ─────────────────────────────────────────────────────────
  let opportunityType;
  let winnerScore;
  let loserScore;
  let evidenceLines;

  if (totalScore < MIN_SIGNAL_SCORE) {
    // Not enough signal either way
    opportunityType = /** @type {OpportunityType} */ ('OTHER');
    winnerScore = 0;
    loserScore = 0;
    evidenceLines = [
      `Insufficient classification signal (total score: ${totalScore}, minimum: ${MIN_SIGNAL_SCORE}).`,
      otherMatched.length ? `Other signals: ${otherMatched.join(', ')}.` : 'No strong signals detected.',
    ];
  } else if (internScore >= jobScore) {
    opportunityType = /** @type {OpportunityType} */ ('INTERNSHIP');
    winnerScore = internScore;
    loserScore  = jobScore;
    const allInternMatches = [
      ...internTitle.matched, ...internEmp.matched, ...internDesc.matched,
    ];
    evidenceLines = [
      `INTERNSHIP score ${internScore} > JOB score ${jobScore}.`,
      `Matched internship signals: ${allInternMatches.join(' · ') || 'none'}.`,
      jobTitle.matched.length || jobDesc.matched.length
        ? `Opposing job signals: ${[...jobTitle.matched, ...jobDesc.matched].join(' · ')}.`
        : null,
    ].filter(Boolean);
  } else {
    opportunityType = /** @type {OpportunityType} */ ('JOB');
    winnerScore = jobScore;
    loserScore  = internScore;
    const allJobMatches = [
      ...jobTitle.matched, ...jobEmp.matched, ...jobDesc.matched,
    ];
    evidenceLines = [
      `JOB score ${jobScore} > INTERNSHIP score ${internScore}.`,
      `Matched job signals: ${allJobMatches.join(' · ') || 'none'}.`,
      internTitle.matched.length || internDesc.matched.length
        ? `Opposing internship signals: ${[...internTitle.matched, ...internDesc.matched].join(' · ')}.`
        : null,
    ].filter(Boolean);
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence;
  if (opportunityType === 'OTHER') {
    confidence = 'LOW';
  } else {
    const ratio = totalScore > 0 ? winnerScore / totalScore : 0;
    if (ratio >= CONFIDENCE_HIGH)        confidence = 'HIGH';
    else if (ratio >= CONFIDENCE_MEDIUM) confidence = 'MEDIUM';
    else                                  confidence = 'LOW';
  }

  /** @type {Confidence} */
  const classificationConfidence = /** @type {Confidence} */ (confidence);

  return {
    opportunity_type:            opportunityType,
    classification_confidence:   classificationConfidence,
    classification_reason:       evidenceLines.join(' '),
    _internship_score:           internScore,
    _job_score:                  jobScore,
  };
}

/**
 * Attach classification fields to a job object in-place (non-destructive copy).
 *
 * @param {OpportunityInput} opportunity
 * @returns {OpportunityInput & ClassificationResult}
 */
export function annotateOpportunity(opportunity) {
  const result = classifyOpportunity(opportunity);
  return { ...opportunity, ...result };
}

/**
 * Decide whether an opportunity passes the user's search mode filter.
 *
 * @param {ClassificationResult} classified
 * @param {'internships'|'jobs'|'both'} searchMode
 * @returns {boolean}
 */
export function meetsSearchMode(classified, searchMode) {
  const mode = searchMode.toLowerCase();
  if (mode === 'internships') return classified.opportunity_type === 'INTERNSHIP';
  if (mode === 'jobs')        return classified.opportunity_type === 'JOB';
  if (mode === 'both')        return classified.opportunity_type === 'INTERNSHIP' || classified.opportunity_type === 'JOB';
  // Unknown mode: pass everything (safe default, don't silently drop)
  return true;
}

/**
 * Filter an array of raw opportunities by search mode.
 *
 * @param {OpportunityInput[]} opportunities
 * @param {'internships'|'jobs'|'both'} searchMode
 * @returns {(OpportunityInput & ClassificationResult)[]}
 */
export function filterOpportunities(opportunities, searchMode) {
  return opportunities
    .map(annotateOpportunity)
    .filter((o) => meetsSearchMode(o, searchMode));
}
