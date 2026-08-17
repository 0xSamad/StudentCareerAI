/**
 * ai-worker-interface.mjs — AI Worker & Provider Contracts
 *
 * Defines contracts for AI providers and intelligent generation services.
 */

export class IAIProvider {
  constructor(name) {
    this.name = name;
  }

  async generateText({ systemPrompt, userPrompt, model, temperature }, context) {
    throw new Error("Method not implemented");
  }

  async generateStructuredJSON({ systemPrompt, userPrompt, schema, model }, context) {
    throw new Error("Method not implemented");
  }
}

export class IAIWorkerService {
  registerProvider(provider) {
    throw new Error("Method not implemented");
  }

  async complete({ prompt, system, schema, tier }, context) {
    throw new Error("Method not implemented");
  }

  async getUsageMetrics(tenantId) {
    throw new Error("Method not implemented");
  }
}
