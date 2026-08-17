/**
 * ai-worker-service.mjs — Multi-Tenant AI Worker Service
 *
 * Implements IAIWorkerService with model routing, tenant quotas, and token tracking.
 */

import { IAIWorkerService, IAIProvider } from "./ai-worker-interface.mjs";
import { PromptGuard } from "../security/prompt-guard.mjs";
import { providersFromEnv } from "./http-chat-provider.mjs";

export class MockAIProvider extends IAIProvider {
  constructor() {
    super("mock");
  }

  async generateText({ userPrompt, systemPrompt }) {
    if (systemPrompt?.includes("cover letter") || userPrompt?.includes("cover letter")) {
      return JSON.stringify({
        subject_line: "Application for Engineering Intern",
        body: "Dear Hiring Manager,\n\nI am eager to apply for this internship as a Computer Science student at LUMS with experience in Python and microservices.",
      });
    }
    return `Generated AI response: ${userPrompt.slice(0, 80)}...`;
  }

  async generateStructuredJSON({ userPrompt, systemPrompt }) {
    // If prompt is for CV tailoring:
    if (systemPrompt?.includes("CV") || userPrompt?.includes("CV") || systemPrompt?.includes("competencies")) {
      return JSON.stringify({
        summary: "Computer Science student at LUMS with expertise in Python, PyTorch, and backend microservices.",
        competencies: ["Python", "PyTorch", "FastAPI", "PostgreSQL"],
        experience: [
          {
            role: "Software Engineering Intern",
            company: "Tech Inc",
            start_date: "2025-06",
            end_date: "2025-08",
            bullets: ["Engineered microservices in FastAPI", "Optimized database queries"],
          },
        ],
        projects: [
          {
            name: "Project AI",
            tagline: "Machine Learning Pipeline",
            bullets: ["Trained BERT model with high accuracy", "Built real-time inference microservice"],
          },
        ],
        tailoring_notes: "Emphasized Python and ML skills without fabrication.",
      });
    }

    // Default match report JSON
    return JSON.stringify({
      match_score: 94,
      dimension_scores: {
        skills_match: 95,
        education_fit: 98,
        project_relevance: 92,
        experience_relevance: 90,
        role_industry_fit: 94,
        location_logistics: 95,
      },
      strengths: ["Strong Python & PyTorch background", "Verified LUMS CS degree"],
      missing_skills: [],
      recommendation: "Outstanding fit for student engineering track.",
    });
  }
}

export class AIWorkerService extends IAIWorkerService {
  constructor(options = {}) {
    super();
    this.providers = new Map();
    this.tenantUsage = new Map(); // tenantId -> { tokensUsed, requestsCount }
    this.defaultProvider = options.defaultProvider || process.env.DEFAULT_AI_PROVIDER || "openai";

    this.registerProvider(new MockAIProvider());
    const liveProviders = providersFromEnv(process.env);
    for (const live of liveProviders) this.registerProvider(live);
    if (!this.providers.has(this.defaultProvider) || this.defaultProvider === "mock") {
      const fallback = this.providers.get("openai") || this.providers.get("openrouter");
      if (fallback) this.defaultProvider = fallback.name;
    }
  }

  registerProvider(provider) {
    if (!provider || !provider.name) throw new Error("Invalid AI provider");
    this.providers.set(provider.name, provider);
  }

  async complete({ prompt, system, schema, providerName, model }, context = {}) {
    const tenantId = context.tenantId || "default";
    const provider = this.providers.get(providerName || this.defaultProvider) || this.providers.get("mock");

    // Track usage per tenant
    const current = this.tenantUsage.get(tenantId) || { tokensUsed: 0, requestsCount: 0 };
    current.requestsCount += 1;
    current.tokensUsed += Math.round(((prompt || "").length + (system || "").length) / 4) + 150;
    this.tenantUsage.set(tenantId, current);

    // Defensive Untrusted Prompt Wrapping & Inspection
    const securePrompt = typeof prompt === "string" ? PromptGuard.wrapUntrustedContent(prompt, "AI Input") : prompt;

    const names = [];
    for (const name of ["openai", "openrouter"]) {
      if (this.providers.has(name) && !names.includes(name)) names.push(name);
    }

    let lastErr = null;
    for (const name of names) {
      const live = this.providers.get(name);
      if (!live || live.name === "mock") continue;
      try {
        if (schema) {
          return await live.generateStructuredJSON({ systemPrompt: system, userPrompt: securePrompt, schema, model }, context);
        }
        return await live.generateText({ systemPrompt: system, userPrompt: securePrompt, model }, context);
      } catch (err) {
        lastErr = err;
      }
    }

    try {
      const { callAI, resolveProvider } = await import("../../ai-provider.mjs");
      const resolved = resolveProvider({
        ai_provider: "gemini",
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      });
      return await callAI(resolved, system || "", securePrompt || prompt || "");
    } catch (err) {
      lastErr = lastErr || err;
    }

    if (provider && provider.name === "mock") {
      if (schema) {
        return provider.generateStructuredJSON({ systemPrompt: system, userPrompt: securePrompt, schema, model }, context);
      }
      return provider.generateText({ systemPrompt: system, userPrompt: securePrompt, model }, context);
    }
    throw lastErr || new Error("No AI provider available");
  }

  async getUsageMetrics(tenantId) {
    return this.tenantUsage.get(tenantId) || { tokensUsed: 0, requestsCount: 0 };
  }
}
