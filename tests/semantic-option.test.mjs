import { fail, pass } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const MOD = pathToFileURL(join(ROOT, 'web/src/lib/apply/semantic-option.mjs')).href;
const { matchOption, matchYesNo, clipToMax, fieldCacheKey } = await import(MOD);

console.log('\nsemantic-option — dropdown/radio matching without inventing options');

{
  const opts = ['High School', 'Associate', "Bachelor's Degree", "Master's", 'PhD'];
  const hit = matchOption(opts, 'BS Software Engineering');
  if (hit === "Bachelor's Degree") pass("BS Software Engineering maps to Bachelor's Degree");
  else fail(`Degree map: ${hit}`);
}

{
  const opts = ['IMS', 'Institute of Management Sciences', 'Other'];
  const hit = matchOption(opts, 'Institute of Management Sciences');
  if (hit === 'Institute of Management Sciences') pass('Full school name wins over the IMS abbreviation when both exist');
  else fail(`School map: ${hit}`);
}

{
  const opts = ['Institute of Management Sciences', 'Other'];
  const hit = matchOption(opts, 'IMS Peshawar');
  if (hit === 'Institute of Management Sciences') pass('IMS alias maps onto the full school option');
  else fail(`IMS alias: ${hit}`);
}

{
  const opts = ['No', 'Yes'];
  const hit = matchOption(opts, 'Yes');
  if (hit === 'Yes' && matchYesNo(opts, 'no') === 'No') pass('Yes/No matching never falls back to the first option');
  else fail(`Yes/No ${hit}`);
}

{
  const clipped = clipToMax('SentimentBot classified student feedback with Python.', 24);
  if (clipped.length <= 24 && clipped !== 'SentimentBot classified student feedback with Python.') {
    pass('clipToMax respects maxlength without leaving a dangling word when possible');
  } else fail(`clip ${JSON.stringify(clipped)}`);
}

{
  const a = fieldCacheKey({ label: 'Degree', type: 'select', options: ["Bachelor's"] });
  const b = fieldCacheKey({ label: '  Degree ', type: 'select', options: ["Bachelor's"] });
  if (a === b && a.includes('degree')) pass('Field cache keys are stable across label whitespace');
  else fail(`cache key ${a} vs ${b}`);
}

{
  const miss = matchOption(['Red', 'Blue'], 'Green');
  if (miss === '') pass('Unmatched options return empty instead of the first choice');
  else fail(`Unmatched leaked ${miss}`);
}
