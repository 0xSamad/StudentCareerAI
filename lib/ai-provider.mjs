/**
 * ai-provider.mjs — Configurable AI Provider Abstraction for CareerOS
 *
 * Resolves the correct AI backend from config and environment, providing
 * a single `callAI(config, systemPrompt, userPrompt)` interface for all
 * consumers (match-engine, etc.).
 *
 * Supported providers:
 *   gemini  — Google Gemini via @google/generative-ai (already installed)
 *   openai  — OpenAI-compatible REST API via the `openai` package
 *   ollama  — Local Ollama instance via raw HTTP fetch (zero new deps)
 *
 * Configuration (from student-profile.yml `matching:` block):
 *   ai_provider: openai        # openai | gemini | ollama | openrouter
 *   model: gpt-5.6-luna        # model name for the chosen provider
 *   temperature: 0.2           # default 0.2 (deterministic scoring)
 *   ollama_url: http://localhost:11434   # only for ollama
 *
 * Fallback resolution when ai_provider is absent:
 *   1. OPENAI_API_KEY or OPENROUTER_API_KEY → openai
 *   2. GEMINI_API_KEY is set → gemini
 *   3. → MatchProviderError (helpful message)
 *
 * Runtime fallback in callAI: OpenAI/OpenRouter first, Gemini second.
 *
 * Design rules:
 *   - Never hardcode a specific model or provider name in callers
 *   - Never expose raw SDK objects — callers receive only text
 *   - Never swallow API errors — re-throw as MatchProviderError
 *   - No side effects: this module only makes HTTP calls
 */

import fs from 'node:fs';
import path from 'node:path';

let envLoaded = false;
function ensureEnvLoaded() {
  if (envLoaded) return;
  envLoaded = true;
  if (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY) {
    return;
  }
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), 'web', '.env.local'),
    path.join(process.cwd(), '..', '.env'),
  ];
  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.trim().match(/^([A-Za-z0-9_]+)=(.*)$/);
          if (match && !process.env[match[1]]) {
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env[match[1]] = val;
          }
        }
      }
    } catch {
      // Ignore unreadable paths
    }
  }
}
ensureEnvLoaded();

// ── Custom Error ──────────────────────────────────────────────────────────────

export class MatchProviderError extends Error {
  /**
   * @param {string} message
   * @param {string} [provider]
   */
  constructor(message, provider) {
    super(message);
    this.name = 'MatchProviderError';
    this.provider = provider || null;
  }
}

// ── Provider Resolution ───────────────────────────────────────────────────────

const VALID_PROVIDERS = ['gemini', 'openai', 'ollama', 'openrouter'];

function hasOpenAiFamilyKey() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
}

function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS);
}

/**
 * Resolve which AI provider to use from config + environment.
 *
 * @param {object} matchingConfig - The `matching:` block from student-profile.yml (may be null/undefined)
 * @returns {{ provider: string, model: string, temperature: number, ollamaUrl: string|null }}
 * @throws {MatchProviderError} If no provider can be resolved
 */
export function resolveProvider(matchingConfig) {
  ensureEnvLoaded();
  const cfg = matchingConfig || {};

  // Explicit provider from config
  let provider = cfg.ai_provider ? String(cfg.ai_provider).toLowerCase().trim() : null;
  if (provider === 'openrouter') provider = 'openai';

  // Validate if explicitly set
  if (provider && !VALID_PROVIDERS.includes(provider)) {
    throw new MatchProviderError(
      `Unknown ai_provider "${provider}". Valid options: openai, gemini, ollama`,
      provider
    );
  }

  // Auto-detect from environment if not explicit — OpenAI family first, Gemini second
  if (!provider) {
    if (hasOpenAiFamilyKey()) {
      provider = 'openai';
    } else if (hasGeminiKey()) {
      provider = 'gemini';
    } else {
      throw new MatchProviderError(
        'No AI provider configured for opportunity matching.\n' +
        'Set one of the following in your student-profile.yml under matching::\n' +
        '  ai_provider: openai   (requires OPENAI_API_KEY or OPENROUTER_API_KEY)\n' +
        '  ai_provider: gemini   (requires GEMINI_API_KEY env var)\n' +
        '  ai_provider: ollama   (requires local Ollama running)\n' +
        'Or set the OPENAI_API_KEY or GEMINI_API_KEY environment variable.'
      );
    }
  }

  // Resolve model
  const model = cfg.model ? String(cfg.model).trim() : defaultModel(provider);

  // Ollama requires an explicit model
  if (provider === 'ollama' && !cfg.model) {
    throw new MatchProviderError(
      'ai_provider is "ollama" but no model is specified.\n' +
      'Add a model name to your student-profile.yml:\n' +
      '  matching:\n' +
      '    ai_provider: ollama\n' +
      '    model: llama3.2',
      'ollama'
    );
  }

  const temperature = typeof cfg.temperature === 'number' ? cfg.temperature : 0.2;
  const ollamaUrl = cfg.ollama_url ? String(cfg.ollama_url).trim() : 'http://localhost:11434';

  return { provider, model, temperature, ollamaUrl };
}

/**
 * @param {string} provider
 * @returns {string}
 */
function defaultModel(provider) {
  switch (provider) {
    case 'gemini': return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    case 'openai': return process.env.OPENAI_MODEL || process.env.DEFAULT_AI_MODEL || 'gpt-5.6-luna';
    case 'ollama': return ''; // No default for ollama — must be explicit
    default: return '';
  }
}

// ── Provider Callers ──────────────────────────────────────────────────────────

/**
 * Call the Gemini API.
 *
 * @param {object} resolved - Output of resolveProvider()
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callGemini(resolved, systemPrompt, userPrompt) {
  const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const apiKeys = rawKeys
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) {
    throw new MatchProviderError(
      'GEMINI_API_KEY is not set. Add it to your .env file or environment.',
      'gemini'
    );
  }

  let GoogleGenerativeAI;
  try {
    ({ GoogleGenerativeAI } = await import('@google/generative-ai'));
  } catch {
    throw new MatchProviderError(
      'The @google/generative-ai package is not installed. Run: npm install',
      'gemini'
    );
  }

  let lastError = null;
  for (const apiKey of apiKeys) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: resolved.model,
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: resolved.temperature,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      });

      const result = await model.generateContent(userPrompt);
      return result.response.text();
    } catch (err) {
      lastError = err;
      const sanitized = sanitizeApiKey(err.message || '', apiKey);
      // If we have more keys to try, attempt the next key
      if (apiKeys.indexOf(apiKey) < apiKeys.length - 1) {
        continue;
      }
      throw new MatchProviderError(`Gemini API error: ${sanitized}`, 'gemini');
    }
  }

  throw new MatchProviderError(`Gemini API error: ${lastError?.message || 'Unknown error'}`, 'gemini');
}

/**
 * Call an OpenAI-compatible API.
 *
 * @param {object} resolved - Output of resolveProvider()
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callOpenAI(resolved, systemPrompt, userPrompt) {
  let OpenAI;
  try {
    ({ default: OpenAI } = await import('openai'));
  } catch {
    throw new MatchProviderError(
      'The openai package is not installed. Run: npm install openai',
      'openai'
    );
  }

  const requested = String(resolved.model || defaultModel('openai')).trim();
  const attempts = [];
  if (process.env.OPENAI_API_KEY) {
    attempts.push({
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      model: requested.includes('/') ? requested.split('/').pop() : requested,
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    attempts.push({
      name: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      model: requested.includes('/') ? requested : `openai/${requested}`,
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'StudentCareer AI',
      },
    });
  }
  if (attempts.length === 0) {
    throw new MatchProviderError(
      'OPENAI_API_KEY is not set. Add it to your .env file or environment.',
      'openai'
    );
  }

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const client = new OpenAI({
        apiKey: attempt.apiKey,
        ...(attempt.baseURL ? { baseURL: attempt.baseURL } : {}),
        ...(attempt.defaultHeaders ? { defaultHeaders: attempt.defaultHeaders } : {}),
      });
      const payload = {
        model: attempt.model,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };
      if (typeof resolved.temperature === 'number' && resolved.temperature !== 0) {
        payload.temperature = resolved.temperature;
      }
      const response = await client.chat.completions.create(payload);
      return response.choices[0]?.message?.content || '';
    } catch (err) {
      lastErr = err;
    }
  }

  const secret = attempts[attempts.length - 1]?.apiKey || '';
  const msg = sanitizeApiKey(lastErr?.message || '', secret);
  throw new MatchProviderError(`OpenAI API error: ${msg}`, 'openai');
}

/**
 * Call a local Ollama instance via HTTP.
 * Zero new npm dependencies — uses the Node.js built-in fetch API (Node ≥ 18).
 *
 * @param {object} resolved - Output of resolveProvider()
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callOllama(resolved, systemPrompt, userPrompt) {
  const url = `${resolved.ollamaUrl}/api/chat`;
  const body = {
    model: resolved.model,
    stream: false,
    options: { temperature: resolved.temperature },
    format: 'json',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new MatchProviderError(
      `Cannot connect to Ollama at ${resolved.ollamaUrl}. ` +
      'Is Ollama running? Start it with: ollama serve\n' +
      `Original error: ${err.message}`,
      'ollama'
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new MatchProviderError(
      `Ollama returned HTTP ${res.status}: ${text.slice(0, 200)}`,
      'ollama'
    );
  }

  const data = await res.json();
  return data?.message?.content || '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call the configured AI provider and return the raw text response.
 *
 * @param {object} resolved       - Output of resolveProvider()
 * @param {string} systemPrompt   - System/instruction prompt
 * @param {string} userPrompt     - User turn (opportunity + profile data)
 * @returns {Promise<string>}     - Raw text (expected to be JSON)
 * @throws {MatchProviderError}   - On API failure or missing credentials
 */
async function callProvider(resolved, systemPrompt, userPrompt) {
  switch (resolved.provider) {
    case 'gemini': return callGemini(resolved, systemPrompt, userPrompt);
    case 'openai':
    case 'openrouter': return callOpenAI(resolved, systemPrompt, userPrompt);
    case 'ollama': return callOllama(resolved, systemPrompt, userPrompt);
    default:
      throw new MatchProviderError(`Unknown provider: ${resolved.provider}`, resolved.provider);
  }
}

export async function callAI(resolved, systemPrompt, userPrompt) {
  try {
    return await callProvider(resolved, systemPrompt, userPrompt);
  } catch (primaryErr) {
    const primary = resolved?.provider;
    if (primary !== 'gemini' && hasGeminiKey()) {
      try {
        return await callGemini(
          { ...resolved, provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
          systemPrompt,
          userPrompt
        );
      } catch {
        throw primaryErr;
      }
    }
    if (primary === 'gemini' && hasOpenAiFamilyKey()) {
      try {
        return await callOpenAI(
          { ...resolved, provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-5.6-luna' },
          systemPrompt,
          userPrompt
        );
      } catch {
        throw primaryErr;
      }
    }
    throw primaryErr;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Remove a secret from an error message before surfacing it to the user.
 * @param {string} msg
 * @param {string} secret
 * @returns {string}
 */
function sanitizeApiKey(msg, secret) {
  if (!secret || !msg) return msg;
  return msg.split(secret).join('[REDACTED]');
}
