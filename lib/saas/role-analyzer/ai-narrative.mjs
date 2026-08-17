/**
 * Optional AI overlay. Frozen FACTS win over the model. Fail closed.
 * May rewrite diagnosis/strategy/week wording. May not invent skills or %.
 */

import { resolveProvider, callAI } from '../../ai-provider.mjs';
import { ROADMAP_SYSTEM_PROMPT } from './evidence.mjs';

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function allowedSkills(evidence) {
  const set = new Set();
  for (const s of evidence.facts?.skillFrequencies || []) set.add(s.skill);
  for (const s of evidence.profile?.namedSkills || []) set.add(s);
  for (const s of evidence.profile?.academicSkills || []) set.add(s);
  for (const g of evidence.gaps || []) set.add(g.skill);
  return set;
}

function allowedPercents(evidence) {
  const set = new Set();
  for (const s of evidence.facts?.skillFrequencies || []) {
    if (s.percent != null) set.add(String(s.percent));
  }
  if (evidence.facts?.readinessScore != null) set.add(String(evidence.facts.readinessScore));
  return set;
}

function inventsForbidden(text, evidence) {
  const allowed = allowedSkills(evidence);
  const blob = String(text || '');
  const pct = blob.match(/(\d{1,3}(?:\.\d+)?)\s*%/g) || [];
  const allowedPct = allowedPercents(evidence);
  for (const token of pct) {
    const n = token.replace(/[^\d.]/g, '');
    if (n && !allowedPct.has(n) && Number(n) > 5) return true;
  }
  const named = blob.match(/\b(PyTorch|TensorFlow|Kubernetes|Snowflake|Spark|Airflow|LangChain)\b/g) || [];
  for (const skill of named) {
    if (!allowed.has(skill)) return true;
  }
  return false;
}

function safeText(value, evidence, max) {
  if (!value) return null;
  const text = String(value);
  if (inventsForbidden(text, evidence)) return null;
  return text.slice(0, max);
}

export async function applyAiNarrative({ evidence, weeks, matchingConfig, callAIFn = null, enabled = true, coach = null }) {
  if (!enabled) return { used: false, weeks, summary: null, coach, error: null };
  let text = '';
  try {
    if (callAIFn) {
      text = await callAIFn(ROADMAP_SYSTEM_PROMPT, JSON.stringify(evidence));
    } else {
      const resolved = resolveProvider(matchingConfig || {});
      text = await callAI(resolved, ROADMAP_SYSTEM_PROMPT, JSON.stringify(evidence));
    }
  } catch (err) {
    const msg = err?.message || String(err);
    if (/404|not found|no longer available|quota|rate limit|401|403/i.test(msg) && !callAIFn) {
      const fallbacks = [
        { ai_provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-5.6-luna' },
        { ai_provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
        { ai_provider: 'gemini', model: 'gemini-flash-latest' },
      ];
      let recovered = false;
      for (const fallback of fallbacks) {
        try {
          const resolved = resolveProvider({ ...(matchingConfig || {}), ...fallback });
          text = await callAI(resolved, ROADMAP_SYSTEM_PROMPT, JSON.stringify(evidence));
          recovered = true;
          break;
        } catch {
          /* try next model */
        }
      }
      if (!recovered) return { used: false, weeks, summary: null, coach, error: msg };
    } else {
      return { used: false, weeks, summary: null, coach, error: msg };
    }
  }

  const parsed = extractJson(text);
  if (!parsed) return { used: false, weeks, summary: null, coach, error: 'AI did not return JSON.' };

  const notes = Array.isArray(parsed.weekNotes) ? parsed.weekNotes : [];
  const byWeek = new Map(notes.map((n) => [Number(n.week), n]));
  const next = weeks.map((w) => {
    const note = byWeek.get(w.week);
    if (!note?.objective) return w;
    if (inventsForbidden(note.objective, evidence) || inventsForbidden(note.resourceWhy || '', evidence)) return w;
    const resources = (w.resources || []).map((r) => ({
      ...r,
      why: note.resourceWhy && !inventsForbidden(note.resourceWhy, evidence) ? note.resourceWhy : r.why,
    }));
    return { ...w, objective: String(note.objective).slice(0, 280), resources };
  });

  const summary = safeText(parsed.summary, evidence, 1200);
  const nextCoach = coach
    ? {
        ...coach,
        executiveSummary: {
          ...coach.executiveSummary,
          diagnosis: safeText(parsed.diagnosis, evidence, 800) || coach.executiveSummary?.diagnosis,
          headline: summary || coach.executiveSummary?.headline,
        },
        strategy: {
          ...coach.strategy,
          why: safeText(parsed.strategyWhy, evidence, 800) || coach.strategy?.why,
        },
        nextAction: {
          ...coach.nextAction,
          today: Array.isArray(parsed.today)
            ? parsed.today.map((t) => safeText(t, evidence, 200)).filter(Boolean).slice(0, 3)
            : coach.nextAction?.today,
        },
      }
    : coach;

  return { used: true, weeks: next, summary, coach: nextCoach, error: null };
}
