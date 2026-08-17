/**
 * Pakistan vs International vs UNKNOWN.
 * Reuses listing-quality location hints. Never assumes: missing location → UNKNOWN.
 */

import { inferLocationFromListing } from '../listing-quality.mjs';

const PK =
  /\b(pakistan|karachi|lahore|islamabad|rawalpindi|faisalabad|peshawar|multan|hyderabad|quetta|sialkot|gujranwala|abbottabad)\b/i;

const NON_PK =
  /\b(united states|\busa\b|\buk\b|united kingdom|canada|germany|france|netherlands|singapore|australia|uae|dubai|india|bangladesh|remote[- ](?:us|uk|eu))\b/i;

export function classifyMarket(opp = {}) {
  const country = String(opp.country || '').trim();
  const location = String(opp.location || '').trim();
  const url = String(opp.applicationUrl || opp.sourceUrl || opp.url || '');
  const title = String(opp.title || '');
  const hay = `${country} ${location} ${title} ${url}`;

  const inferred = inferLocationFromListing(url, `${title} ${location}`) || '';
  const combined = `${hay} ${inferred}`;

  const pkHit = PK.test(combined) || /pakistan/i.test(country);
  const intlHit = NON_PK.test(combined) || (country && !/pakistan/i.test(country));

  if (pkHit && intlHit) return 'UNKNOWN';
  if (pkHit) return 'PAKISTAN';
  if (intlHit) return 'INTERNATIONAL';
  if (country && /pakistan/i.test(country)) return 'PAKISTAN';
  if (country) return 'INTERNATIONAL';
  return 'UNKNOWN';
}

export function filterByMarketScope(market, scope = 'ALL') {
  const s = String(scope || 'ALL').toUpperCase();
  if (s === 'PAKISTAN') return market === 'PAKISTAN';
  if (s === 'INTERNATIONAL') return market === 'INTERNATIONAL';
  return true;
}
