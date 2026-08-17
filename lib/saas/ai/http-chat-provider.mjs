/**
 * HTTP chat completions provider (OpenAI-compatible: OpenAI, OpenRouter).
 * Used when an API key is present. Never invents CV facts; callers must ground prompts.
 */

import { IAIProvider } from "./ai-worker-interface.mjs";

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return "{}";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{") >= 0 && (body.indexOf("[") < 0 || body.indexOf("{") < body.indexOf("["))
    ? body.indexOf("{")
    : body.indexOf("[");
  const end = start === body.indexOf("{") ? body.lastIndexOf("}") : body.lastIndexOf("]");
  if (start < 0 || end <= start) return body;
  return body.slice(start, end + 1);
}

export class HttpChatProvider extends IAIProvider {
  constructor({ name = "openai", apiKey, baseUrl, defaultModel }) {
    super(name);
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = defaultModel || "gpt-5.6-luna";
  }

  async generateText({ systemPrompt, userPrompt, model, temperature } = {}, _context = {}) {
    const headers = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
    if (this.name === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost:3000";
      headers["X-Title"] = "StudentCareer AI";
    }
    const body = {
      model: model || this.defaultModel,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: String(systemPrompt) }] : []),
        { role: "user", content: String(userPrompt || "") },
      ],
    };
    if (typeof temperature === "number" && temperature !== 0) {
      body.temperature = temperature;
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`AI provider ${this.name} failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || "");
  }

  async generateStructuredJSON(args, context) {
    const text = await this.generateText(args, context);
    return extractJson(text);
  }
}

export function providersFromEnv(env = process.env) {
  const openai = String(env.OPENAI_API_KEY || "").trim();
  const openrouter = String(env.OPENROUTER_API_KEY || "").trim();
  const preferred = String(env.DEFAULT_AI_PROVIDER || "openai").trim().toLowerCase();
  const openaiProvider = openai
    ? new HttpChatProvider({
        name: "openai",
        apiKey: openai,
        baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        defaultModel: env.OPENAI_MODEL || "gpt-5.6-luna",
      })
    : null;
  const openrouterProvider = openrouter
    ? new HttpChatProvider({
        name: "openrouter",
        apiKey: openrouter,
        baseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        defaultModel: env.DEFAULT_AI_MODEL || env.OPENAI_MODEL || "openai/gpt-5.6-luna",
      })
    : null;
  const out = [];
  if (preferred === "openrouter") {
    if (openrouterProvider) out.push(openrouterProvider);
    if (openaiProvider) out.push(openaiProvider);
  } else {
    if (openaiProvider) out.push(openaiProvider);
    if (openrouterProvider) out.push(openrouterProvider);
  }
  return out;
}

export function providerFromEnv(env = process.env) {
  const all = providersFromEnv(env);
  const preferred = String(env.DEFAULT_AI_PROVIDER || "openai").trim().toLowerCase();
  return all.find((p) => p.name === preferred) || all[0] || null;
}

export function hasLiveAi(env = process.env) {
  return Boolean(providerFromEnv(env));
}
