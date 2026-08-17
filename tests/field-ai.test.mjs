import { fail, pass } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { MOCK_PROFILE, MOCK_CV } from './fixtures/mock-applications.mjs';

const AI = pathToFileURL(join(ROOT, 'web/src/lib/apply/field-ai.mjs')).href;
const GUESS = pathToFileURL(join(ROOT, 'web/src/lib/apply/guess-form-answers.mjs')).href;
const { batchFieldAnswers, resetFieldAiCacheForTests } = await import(AI);
const { completeFormAnswers } = await import(GUESS);

console.log('\nfield-ai — batched grounded leftover answers');

resetFieldAiCacheForTests();

{
  let calls = 0;
  const fields = [
    { id: 'p', type: 'textarea', label: 'Tell us about a project', maxLength: 80 },
    { id: 'lang', type: 'select', label: 'Favourite language', options: ['Java', 'Python', 'Rust'] },
    { id: 'pay', type: 'text', label: 'Expected salary' },
  ];
  const first = await batchFieldAnswers({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    extras: { company: 'Acme', role: 'Intern' },
    generateFn: async (need) => {
      calls += 1;
      return {
        answers: need.map((f) => ({
          id: f.id,
          action: 'fill',
          value: /language/i.test(f.label) ? 'Python' : 'I invented a $200k salary at Invented Labs',
          confidence: 0.95,
          reason: 'test',
        })),
      };
    },
  });
  const second = await batchFieldAnswers({
    fields: [fields[1]],
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    generateFn: async () => {
      calls += 1;
      return { answers: [] };
    },
  });
  const salarySkipped = first.answers.pay == null;
  const langCached = second.answers.lang === 'Python' && !second.called;
  if (calls === 1 && salarySkipped && langCached && first.answers.lang === 'Python' && !first.answers.p) {
    pass('One batched AI call, salary skipped, invented prose dropped, language cached on the second field');
  } else fail(`AI batch calls=${calls} answers=${JSON.stringify(first.answers)} cached=${JSON.stringify(second)}`);
}

{
  resetFieldAiCacheForTests();
  const fields = [{ id: 'colour', type: 'text', label: 'Favourite colour' }];
  const out = await batchFieldAnswers({
    fields,
    profile: MOCK_PROFILE,
    cvText: MOCK_CV,
    generateFn: async () => ({
      answers: [{ id: 'colour', action: 'human_input_required', confidence: 0.2, value: '', reason: 'missing' }],
    }),
  });
  if (!out.answers.colour) pass('human_input_required leaves the leftover unanswered');
  else fail(`Guessed colour ${out.answers.colour}`);
}

{
  resetFieldAiCacheForTests();
  const fields = [
    { id: 'a', type: 'text', label: 'Email' },
    { id: 'b', type: 'text', label: 'Favourite colour' },
  ];
  const merged = await completeFormAnswers(fields, { a: 'ali@example.com' }, MOCK_PROFILE, {
    cvText: MOCK_CV,
    generateFn: async () => ({
      answers: [{ id: 'b', action: 'fill', value: 'Blue because I like the sky', confidence: 0.99, reason: 'invented' }],
    }),
  });
  if (merged.a === 'ali@example.com' && !merged.b) {
    pass('completeFormAnswers keeps attested answers and drops invented leftover text');
  } else fail(`completeFormAnswers ${JSON.stringify(merged)}`);
}

{
  resetFieldAiCacheForTests();
  const fields = [{ id: 'crime', type: 'radio', label: 'Have you ever been convicted of a crime?', options: ['Yes', 'No'] }];
  const merged = await completeFormAnswers(fields, {}, MOCK_PROFILE, {
    cvText: MOCK_CV,
    generateFn: async () => {
      throw new Error('must not call AI for criminal history');
    },
  });
  if (!merged.crime) pass('completeFormAnswers never sends criminal-history leftovers to AI');
  else fail(`Criminal leftover leaked ${merged.crime}`);
}
