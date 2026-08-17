import { fail, pass, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { MOCK_PROFILE, MOCK_CV, greenhouseOpportunity, leverOpportunity, workdayOpportunity } from './fixtures/mock-applications.mjs';

const MOD = pathToFileURL(join(ROOT, 'web/src/lib/apply/form-agent.mjs')).href;
const {
  planFormTurn,
  decideAction,
  inferStageName,
  repeatingSectionPlan,
  interpretVerification,
  recordFormStage,
  getFormAgentState,
  resetFormAgentStateForTests,
  extraFactForField,
  CONFIDENCE,
  widgetKind,
  setFormAgentPersistPath,
  loadFormAgentPersist,
  formAgentResumeKey,
  answersExcludingFilled,
  fieldAlreadyValued,
} = await import(MOD);

const ANS = pathToFileURL(join(ROOT, 'web/src/lib/apply/answers-from-profile.mjs')).href;
const { answersFromProfile } = await import(ANS);

console.log('\nform-agent — hybrid URL apply planner (deterministic + confidence)');

resetFormAgentStateForTests();

function fieldsFrom(opp, extras = []) {
  return (opp.application_fields || []).map((f, i) => ({
    id: `co${i}`,
    type: f.type || 'text',
    label: f.label,
    nativeName: f.name,
    required: !!f.required,
    options: f.options || [],
  })).concat(extras);
}

{
  if (decideAction(96) === 'fill' && decideAction(78) === 'fill' && decideAction(69) === 'wait') {
    pass('Confidence gate: HIGH/MEDIUM fill, below 70 waits');
  } else fail('Confidence thresholds are wrong');
}

{
  const gh = fieldsFrom(greenhouseOpportunity());
  const turn = await planFormTurn({ fields: gh, profile: MOCK_PROFILE, cvText: MOCK_CV, sessionId: 'gh' });
  if (turn.fillAnswers.co0 === 'Ali' && turn.fillAnswers.co2 === 'ali@example.com' && turn.stage === 'Personal Information') {
    pass('Greenhouse-shaped form fills attested name/email at high confidence');
  } else fail(`Greenhouse plan: ${JSON.stringify(turn.fillAnswers)} stage=${turn.stage}`);
}

{
  const gh = fieldsFrom(greenhouseOpportunity());
  const first = await planFormTurn({ fields: gh, profile: MOCK_PROFILE, cvText: MOCK_CV, sessionId: 'skip-1' });
  const again = await planFormTurn({
    fields: gh,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    sessionId: 'skip-2',
    skipFieldIds: Object.keys(first.fillAnswers),
  });
  const skipped = Object.keys(first.fillAnswers).every((id) => !again.fillAnswers[id]);
  const already = fieldAlreadyValued({ type: 'text', value: 'Ali' }) && !fieldAlreadyValued({ type: 'text', value: '' }) && !fieldAlreadyValued({ type: 'select', value: '-- No answer --' });
  const stripped = answersExcludingFilled({ co0: 'Ali', co2: 'ali@example.com' }, ['co0']);
  if (skipped && already && stripped.co0 == null && stripped.co2 === 'ali@example.com') {
    pass('Already-filled fields are skipped and not planned again');
  } else fail(`Skip filled: again=${JSON.stringify(again.fillAnswers)} stripped=${JSON.stringify(stripped)}`);
}

{
  const fields = [
    { id: 'name', type: 'text', label: 'First name' },
    { id: 'cap', type: 'checkbox', label: 'Human Check' },
    { id: 'fintech', type: 'select', label: 'Are you comfortable working on fintech projects?', options: ['Yes', 'No'], value: '-- No answer --' },
    { id: 'ai', type: 'select', label: 'Have you used any AI tools to improve productivity in your professional work?', options: ['Yes', 'No'] },
  ];
  const turn = await planFormTurn({
    fields,
    profile: { ...MOCK_PROFILE, identity: { ...MOCK_PROFILE.identity }, preferences: { ...MOCK_PROFILE.preferences } },
    cvText: `${MOCK_CV}\nTools: ChatGPT, Cursor`,
    extras: { fillRemaining: true },
  });
  if (
    turn.fillAnswers.name === 'Ali' &&
    turn.fillAnswers.fintech === 'Yes' &&
    turn.fillAnswers.ai &&
    turn.fillAnswers.cap == null
  ) {
    pass('CAPTCHA is skipped; empty fields above it still fill');
  } else fail(`Captcha skip fill ${JSON.stringify(turn.fillAnswers)}`);
}

{
  const lever = fieldsFrom(leverOpportunity());
  const turn = await planFormTurn({
    fields: lever,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    extras: { coverLetter: 'Dear Nayapay, I built SentimentBot in Python.' },
  });
  const coverId = lever.find((f) => /cover/i.test(f.label))?.id;
  if (turn.fillAnswers[lever[0].id] === 'Ali Hassan' && turn.fillAnswers[coverId]?.includes('SentimentBot')) {
    pass('Lever-shaped form uses attested full name and cover letter');
  } else fail(`Lever plan: ${JSON.stringify(turn.fillAnswers)}`);
}

{
  const wd = fieldsFrom(workdayOpportunity());
  const bare = { ...MOCK_PROFILE, preferences: { locations: { preferred: ['Lahore'] } } };
  const turn = await planFormTurn({ fields: wd, profile: bare, cvText: MOCK_CV });
  const auth = wd.find((f) => /authoriz/i.test(f.label));
  const waited = turn.waiting.some((w) => w.fieldId === auth.id);
  if (waited && !turn.fillAnswers[auth.id]) {
    pass('Workday work-authorization without attested visa status waits instead of guessing');
  } else fail(`Work auth was filled: ${turn.fillAnswers[auth.id]}`);
}

{
  const withVisa = {
    ...MOCK_PROFILE,
    preferences: { ...MOCK_PROFILE.preferences, sponsorship: { needs_sponsorship: false, visa_status: 'citizen' } },
  };
  const wd = fieldsFrom(workdayOpportunity(), [{ id: 'coAuth', type: 'select', label: 'Are you authorized to work in Pakistan?', options: ['Yes', 'No'] }]);
  const turn = await planFormTurn({ fields: wd, profile: withVisa, cvText: MOCK_CV });
  if (turn.fillAnswers.coAuth === 'Yes') pass('Attested citizen status can answer work authorization');
  else fail(`Expected Yes, got ${turn.fillAnswers.coAuth}`);
}

{
  const fields = [{ id: 'gpa', type: 'text', label: 'What is your CGPA?' }];
  const extra = extraFactForField(fields[0], MOCK_PROFILE, MOCK_CV);
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (extra.confidence >= 95 && turn.fillAnswers.gpa === '3.8') pass('CGPA is filled from the verified education record');
  else fail(`GPA ${turn.fillAnswers.gpa} conf=${extra.confidence}`);
}

{
  const fields = [{ id: 'langs', type: 'textarea', label: 'What programming languages do you know?' }];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (/Python/.test(turn.fillAnswers.langs) && /JavaScript/.test(turn.fillAnswers.langs)) {
    pass('Programming-language question maps to verified skills');
  } else fail(`Skills answer: ${turn.fillAnswers.langs}`);
}

{
  const fields = [{ id: 'proj', type: 'textarea', label: 'Describe your AI project.' }];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (/SentimentBot/.test(turn.fillAnswers.proj) && /feedback/.test(turn.fillAnswers.proj)) {
    pass('AI project question uses the attested SentimentBot project');
  } else fail(`Project answer: ${turn.fillAnswers.proj}`);
}

{
  const fields = [{ id: 'pay', type: 'text', label: 'Expected salary (PKR)' }];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  const leftover = answersFromProfile(fields, MOCK_PROFILE, { fillRemaining: true });
  if (!turn.fillAnswers.pay && turn.waiting.some((w) => w.fieldId === 'pay') && leftover.pay === '80000') {
    pass('Agent does not guess salary; in-app fillRemaining still can (unchanged)');
  } else fail(`Salary agent=${turn.fillAnswers.pay} leftover=${leftover.pay}`);
}

{
  const fields = [
    { id: 'uni1', type: 'text', label: 'University' },
    { id: 'uni2', type: 'text', label: 'University 2' },
    { id: 'add', type: 'text', label: 'Add another school' },
  ];
  const profile = {
    ...MOCK_PROFILE,
    education: [
      { university: 'LUMS', degree: 'BS', major: 'CS' },
      { university: 'IMS Peshawar', degree: 'Intermediate' },
    ],
  };
  const plan = repeatingSectionPlan(profile);
  const turn = await planFormTurn({ fields, profile, cvText: MOCK_CV });
  if (plan.addEducation === 1 && turn.fillAnswers.uni1 === 'LUMS' && turn.fillAnswers.uni2 === 'IMS Peshawar') {
    pass('Repeating education maps two attested schools and plans one Add-another');
  } else fail(`Repeating: ${JSON.stringify({ plan, answers: turn.fillAnswers })}`);
}

{
  resetFormAgentStateForTests();
  recordFormStage('sess-1', 'Personal Information', 'complete');
  recordFormStage('sess-1', 'Education', 'complete');
  recordFormStage('sess-1', 'Academic Reference', 'waiting');
  const st = getFormAgentState('sess-1');
  const personal = inferStageName([{ label: 'First Name' }, { label: 'Email' }]);
  const edu = inferStageName([{ label: 'University' }, { label: 'CGPA' }]);
  const ref = inferStageName([{ label: 'Academic reference email' }]);
  if (personal === 'Personal Information' && edu === 'Education' && ref === 'Academic Reference' && st.stages.find((s) => s.name === 'Academic Reference')?.status === 'waiting') {
    pass('Multi-stage state is recorded and resumable (reference waits, earlier stages complete)');
  } else fail(`Stages: ${JSON.stringify(st.stages)}`);
}

{
  const first = interpretVerification({ mismatches: ['City'], requiredEmpty: [] }, {});
  const second = interpretVerification({ mismatches: ['City'], requiredEmpty: [] }, first.attempts);
  if (first.retry.includes('City') && second.wait.includes('City') && !second.retry.includes('City')) {
    pass('Verification retries once, then WAITING_FOR_USER');
  } else fail(`Verify ${JSON.stringify({ first, second })}`);
}

{
  const fields = [
    { id: "n", type: "text", label: "Full name", required: true },
    { id: "crime", type: "radio", label: "Have you ever been convicted of a crime?", required: true, options: ["Yes", "No"] },
  ];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (turn.fillAnswers.n === "Ali Hassan" && !turn.fillAnswers.crime && turn.navigation === "stay") {
    pass("Criminal-history radio waits (no guess) and keeps the agent on this stage");
  } else fail(`Crime ${JSON.stringify({ answers: turn.fillAnswers, nav: turn.navigation })}`);
}

{
  const fields = [
    { id: "country", type: "select", label: "Country", options: ["Pakistan", "United States", "Other"] },
    { id: "city", type: "text", label: "City", combobox: true },
    { id: "grad", type: "date", label: "Graduation date" },
    { id: "langs", type: "checkbox", label: "What programming languages do you know?" },
  ];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  const kinds = fields.map((f) => widgetKind(f));
  if (
    turn.fillAnswers.country === "Pakistan" &&
    /Lahore/.test(turn.fillAnswers.city) &&
    turn.fillAnswers.grad === "2027-01-01" &&
    /Python/.test(turn.fillAnswers.langs) &&
    kinds.join(",") === "country-selector,city-selector,date-picker,checkbox"
  ) {
    pass("Country, city combobox, date picker, and skills checkbox map from attested profile");
  } else fail(`Widgets ${JSON.stringify({ answers: turn.fillAnswers, kinds })}`);
}

{
  const ashby = [
    { id: "a0", type: "text", label: "First Name" },
    { id: "a1", type: "text", label: "Last Name" },
    { id: "a2", type: "email", label: "Email" },
    { id: "a3", type: "select", label: "Location", combobox: true },
    { id: "a4", type: "textarea", label: "Additional information / cover letter", nativeName: "comments" },
  ];
  const turn = await planFormTurn({
    fields: ashby,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    extras: { coverLetter: "Dear Ashby team, SentimentBot is my main project." },
  });
  if (turn.fillAnswers.a0 === "Ali" && /Lahore/.test(turn.fillAnswers.a3) && /SentimentBot/.test(turn.fillAnswers.a4)) {
    pass("Ashby-shaped form fills name, location combobox, and cover letter without treating additional-info as a repeating row");
  } else fail(`Ashby ${JSON.stringify(turn.fillAnswers)}`);
}

{
  const fields = [{ id: "dob", type: "date", label: "Date of birth" }];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (!turn.fillAnswers.dob && turn.waiting.some((w) => w.fieldId === "dob")) {
    pass("Date of birth waits unless it is attested on the profile");
  } else fail(`DOB was filled: ${turn.fillAnswers.dob}`);
}

{
  const fields = [{ id: 'emp', type: 'text', label: 'Favourite colour' }];
  const turn = await planFormTurn({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    aiFn: async () => ({ emp: 'Invented Labs' }),
  });
  if (!turn.fillAnswers.emp && turn.waiting.some((w) => w.fieldId === 'emp')) {
    pass('AI cannot invent an unattested employer/colour — field waits');
  } else fail(`Invented answer leaked: ${turn.fillAnswers.emp}`);
}

{
  const fields = [{ id: 'why', type: 'textarea', label: 'Which project should we know about?' }];
  const turn = await planFormTurn({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    aiFn: async () => ({ why: 'SentimentBot classified student feedback' }),
  });
  if (/SentimentBot/.test(turn.fillAnswers.why) && turn.planned.find((p) => p.fieldId === 'why')?.confidence >= 70) {
    pass('AI may fill an unfamiliar project question only with a grounded profile fact');
  } else fail(`Grounded AI: ${turn.fillAnswers.why}`);
}

{
  const fields = [
    { id: 'sponsor', type: 'select', label: 'Will you now or in the future require sponsorship?', required: true, options: ['Yes', 'No'] },
  ];
  const waiting = await planFormTurn({ fields, profile: { identity: { name: 'Ali' } }, cvText: MOCK_CV });
  const answered = await planFormTurn({
    fields,
    profile: { identity: { name: 'Ali' } },
    cvText: MOCK_CV,
    userAnswers: { byId: { sponsor: 'No' }, byLabel: { 'will you now or in the future require sponsorship?': 'No' } },
  });
  if (!waiting.fillAnswers.sponsor && waiting.navigation === 'stay' && answered.fillAnswers.sponsor === 'No') {
    pass('Sponsorship waits until the user answers, then fills the attested response');
  } else fail(`User answer path: wait=${JSON.stringify(waiting.fillAnswers)} filled=${answered.fillAnswers.sponsor}`);
}

{
  const tmp = join(ROOT, 'data', 'test-apply-agent-state.json');
  try {
    setFormAgentPersistPath(tmp);
    resetFormAgentStateForTests();
    const key = formAgentResumeKey('https://jobs.ashbyhq.com/acme/apply');
    recordFormStage(key, 'Personal Information', 'complete');
    recordFormStage(key, 'Education', 'waiting');
    resetFormAgentStateForTests();
    loadFormAgentPersist();
    const st = getFormAgentState(key);
    if (st.stages.find((s) => s.name === 'Personal Information')?.status === 'complete' && st.stages.find((s) => s.name === 'Education')?.status === 'waiting') {
      pass('Stage progress persists to disk so a paused URL apply can resume');
    } else fail(`Resume state: ${JSON.stringify(st.stages)}`);
  } finally {
    setFormAgentPersistPath('');
    resetFormAgentStateForTests();
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

{
  const fields = [
    { id: 'atl', type: 'radio', label: 'Are you currently a University student in the Atlanta area pursuing an Engineering degree?', options: ['Yes', 'No'] },
    { id: 'grad', type: 'radio', label: 'When is your anticipated graduation date?', options: ['Fall 2026', 'Spring 2027', 'Summer 2027', 'Fall 2027 or beyond'] },
    { id: 'sponsor', type: 'radio', label: 'Will you now or in the future require sponsorship to work in the US?', options: ['Yes', 'No'] },
    { id: 'clear', type: 'radio', label: 'Are you able to hold a U.S. Security Clearance?', options: ['Yes', 'No'] },
  ];
  const nested = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  const flat = await planFormTurn({
    fields,
    profile: {
      identity: { city: 'Peshawar', country: 'Pakistan' },
      education: [{ university: 'IMS', degree: 'BS', major: 'Software Engineering', graduation_date: '2028-08' }],
      preferences: { needs_sponsorship: false },
    },
    cvText: MOCK_CV,
  });
  if (
    nested.fillAnswers.atl === 'No' &&
    nested.fillAnswers.grad === 'Summer 2027' &&
    nested.fillAnswers.sponsor === 'No' &&
    !nested.fillAnswers.clear &&
    nested.waiting.some((w) => w.fieldId === 'clear') &&
    flat.fillAnswers.sponsor === 'No' &&
    flat.fillAnswers.grad === 'Fall 2027 or beyond'
  ) {
    pass('Screening radios fill attested No/term answers and wait on security clearance');
  } else fail(`Radios nested=${JSON.stringify(nested.fillAnswers)} wait=${JSON.stringify(nested.waiting)} flat=${JSON.stringify(flat.fillAnswers)}`);
}

{
  const fields = [
    { id: 'hard', type: 'textarea', label: "What's something hard you built recently, and why did you build it?" },
    { id: 'avail', type: 'select', label: 'Are you available for a 3-month, 40 hrs/week internship?', options: ['Yes', 'No'] },
    { id: 'auth', type: 'select', label: 'Are you legally authorized to work in the location where this role is based?', options: ['Yes', 'No'] },
    { id: 'heard', type: 'textarea', label: "How did you come to learn about Xsolla? We're delighted to know more about your journey to discovering our company. (Events, Friends, LinkedIn etc.)" },
    { id: 'game', type: 'select', label: 'Do you have prior work experience in the Gaming industry?', options: ['Yes', 'No'] },
    { id: 'gender', type: 'select', label: 'Gender', options: ['Male', 'Female', 'Decline to self identify'] },
    { id: 'genderVol', type: 'select', label: 'Gender (completion is voluntary)', options: ['Male', 'Female'] },
    { id: 'race', type: 'select', label: 'Race', options: ['White', 'Asian', 'Decline to self identify'] },
    { id: 'vet', type: 'select', label: 'Veteran status', options: ['I am not a protected veteran', 'Decline to self identify'] },
  ];
  const profile = {
    identity: {
      name: 'ABDUL SAMAD',
      city: 'Peshawar',
      country: 'Pakistan',
      gender: 'Male',
      linkedin: 'https://linkedin.com/in/abdulsamad57',
    },
    preferences: { search_mode: 'internships', needs_sponsorship: false, work_authorization: '' },
    projects: [],
  };
  const cv = 'Bug Bounty Researcher — HackerOne. Self-directed CTFs and pentest labs. OWASP IDOR XSS.';
  const turn = await planFormTurn({
    fields,
    profile,
    cvText: cv,
    extras: { jdText: 'AI-First Engineering Intern\nLos Angeles, United States', role: 'AI-First Engineering Intern', company: 'Xsolla' },
  });
  const hardOk = /HackerOne|CTF|pentest/i.test(turn.fillAnswers.hard || '');
  const heardOk = /LinkedIn/i.test(turn.fillAnswers.heard || '');
  if (
    hardOk &&
    turn.fillAnswers.avail === 'Yes' &&
    turn.fillAnswers.auth === 'No' &&
    heardOk &&
    turn.fillAnswers.game === 'No' &&
    turn.fillAnswers.gender === 'Male' &&
    turn.fillAnswers.genderVol === 'Male' &&
    !turn.fillAnswers.race &&
    !turn.fillAnswers.vet
  ) {
    pass('Lever screening fills attested short answers and Yes/No dropdowns; skips race/veteran');
  } else fail(`Xsolla plan: ${JSON.stringify(turn.fillAnswers)} wait=${JSON.stringify(turn.waiting)}`);
}

{
  const fields = [
    {
      id: 'deg',
      type: 'select',
      label: 'Degree',
      options: ['High School', 'Associate', "Bachelor's Degree", "Master's", 'PhD'],
    },
  ];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (turn.fillAnswers.deg === "Bachelor's Degree") {
    pass("Semantic degree match: BS Computer Science → Bachelor's Degree, not the first option");
  } else fail(`Degree picked ${turn.fillAnswers.deg}`);
}

{
  const fields = [
    {
      id: 'uni',
      type: 'select',
      label: 'University',
      options: ['IMS', 'Institute of Management Sciences', 'Other'],
    },
  ];
  const profile = {
    ...MOCK_PROFILE,
    education: [{ university: 'Institute of Management Sciences', degree: 'BS', major: 'Software Engineering' }],
  };
  const turn = await planFormTurn({ fields, profile, cvText: MOCK_CV });
  if (turn.fillAnswers.uni === 'Institute of Management Sciences') {
    pass('Semantic university match prefers the full attested school name');
  } else fail(`University picked ${turn.fillAnswers.uni}`);
}

{
  const fields = [
    {
      id: 'auth',
      type: 'radio',
      label: 'Are you legally authorized to work in Pakistan?',
      required: true,
      options: ['No', 'Yes'],
    },
  ];
  const turn = await planFormTurn({ fields, profile: MOCK_PROFILE, cvText: MOCK_CV });
  if (turn.fillAnswers.auth === 'Yes' && turn.audit?.filled?.includes('Are you legally authorized to work in Pakistan?')) {
    pass('Work-auth radio selects Yes, not the first option, and records an audit row');
  } else fail(`Radio ${JSON.stringify({ answers: turn.fillAnswers, audit: turn.audit })}`);
}

{
  const fields = [
    { id: 'why', type: 'textarea', label: 'Why do you want to work here?', maxLength: 48 },
  ];
  const turn = await planFormTurn({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    extras: { coverLetter: 'Dear Acme, I built SentimentBot in Python and want to keep shipping useful tools for students.' },
  });
  if (turn.fillAnswers.why && turn.fillAnswers.why.length <= 48 && /SentimentBot/.test(turn.fillAnswers.why)) {
    pass('Textarea answers are clipped to maxlength and stay grounded in the cover letter');
  } else fail(`Textarea ${JSON.stringify(turn.fillAnswers.why)}`);
}

{
  let calls = 0;
  const fields = [
    { id: 'q1', type: 'text', label: 'Which project should we discuss in the interview?' },
    { id: 'q2', type: 'select', label: 'Primary language', options: ['Python', 'Java', 'Go'] },
    { id: 'crime', type: 'radio', label: 'Have you been convicted of a felony?', required: true, options: ['Yes', 'No'] },
  ];
  const turn = await planFormTurn({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    fieldAi: true,
    generateFn: async (need) => {
      calls += 1;
      return {
        answers: need.map((f) => ({
          id: f.id,
          action: 'fill',
          value: /language/i.test(f.label) ? 'Python' : 'SentimentBot classified student feedback',
          confidence: 0.94,
          reason: 'attested',
        })),
      };
    },
  });
  if (
    calls === 1 &&
    /SentimentBot/.test(turn.fillAnswers.q1) &&
    turn.fillAnswers.q2 === 'Python' &&
    !turn.fillAnswers.crime &&
    turn.navigation === 'stay'
  ) {
    pass('Batched field AI is one call, grounded, and still waits on unknown criminal history');
  } else fail(`Batch AI calls=${calls} answers=${JSON.stringify(turn.fillAnswers)} nav=${turn.navigation}`);
}

{
  const fields = [{ id: 'colour', type: 'text', label: 'Favourite colour', required: true }];
  const turn = await planFormTurn({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    fieldAi: true,
    generateFn: async () => ({
      answers: [{ id: 'colour', action: 'human_input_required', value: '', confidence: 0.2, reason: 'Not in profile' }],
    }),
  });
  if (!turn.fillAnswers.colour && turn.waiting.some((w) => w.fieldId === 'colour') && turn.navigation === 'stay') {
    pass('Unknown questions stay WAITING_FOR_USER instead of guessing');
  } else fail(`Unknown ${JSON.stringify({ answers: turn.fillAnswers, waiting: turn.waiting })}`);
}

{
  const fields = [
    { id: 'name', type: 'text', label: 'Full name', required: true },
    { id: 'stuck', type: 'select', label: 'Favourite colour', required: true, options: ['Red', 'Blue'] },
    { id: 'email', type: 'email', label: 'Email' },
  ];
  const turn = await planFormTurn({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    skipFieldIds: ['stuck'],
  });
  if (
    turn.fillAnswers.name &&
    turn.fillAnswers.email &&
    !turn.fillAnswers.stuck &&
    !turn.waiting.some((w) => w.fieldId === 'stuck')
  ) {
    pass('Planner skips a stuck field and still fills the rest');
  } else fail(`Skip stuck ${JSON.stringify({ answers: turn.fillAnswers, waiting: turn.waiting })}`);
}

