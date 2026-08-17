/**
 * discovery-interface.mjs — Pluggable Job Source & Discovery Interfaces
 *
 * Defines contracts for ATS and public feed scrapers.
 */

export class IJobSource {
  constructor(name) {
    this.name = name;
  }

  async fetchOpportunities(queryOptions, context) {
    throw new Error("Method not implemented");
  }

  async fetchJobDetails(jobUrl, context) {
    throw new Error("Method not implemented");
  }
}

export class IDiscoveryService {
  registerSource(source) {
    throw new Error("Method not implemented");
  }

  async discoverAll(options, context) {
    throw new Error("Method not implemented");
  }
}
