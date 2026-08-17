/**
 * discovery-service.mjs — Multi-Tenant Job Discovery Service
 *
 * Implements IDiscoveryService with pluggable ATS adapters and deduplication.
 */

import { IDiscoveryService, IJobSource } from "./discovery-interface.mjs";
import { URLValidator } from "../security/url-validator.mjs";

export class MockJobSource extends IJobSource {
  constructor() {
    super("mock_ats");
  }

  async fetchOpportunities(queryOptions = {}) {
    // Explicitly marked as demo — callers must never present these as live jobs.
    const stamp = Date.now();
    return [
      {
        id: `demo_careem_${stamp}`,
        company: "Careem (DEMO)",
        title: "AI / Machine Learning Engineering Intern",
        opportunity_type: "INTERNSHIP",
        location: "Lahore, Pakistan",
        url: `https://example.com/demo/careem/${stamp}`,
        description: "DEMO FIXTURE ONLY — not a real job posting.",
        postedDate: new Date().toISOString().slice(0, 10),
        source: "demo",
        source_type: "DEMO",
        source_name: "MockJobSource",
        is_demo: true,
        is_verified: false,
      },
    ];
  }

  async fetchJobDetails(jobUrl) {
    return {
      url: jobUrl,
      description: "DEMO FIXTURE ONLY — not a real job posting.",
      requirements: [],
      is_demo: true,
    };
  }
}

export class JobDiscoveryService extends IDiscoveryService {
  constructor({ opportunityRepository, includeDemoSources = false } = {}) {
    super();
    this.opportunityRepository = opportunityRepository;
    this.sources = new Map();
    // Production path: NO mock sources by default.
    if (includeDemoSources || process.env.ALLOW_DEMO_JOB_SOURCES === "true") {
      this.registerSource(new MockJobSource());
    }
  }

  registerSource(source) {
    if (!source || !source.name) throw new Error("Invalid job source adapter");
    this.sources.set(source.name, source);
  }

  async discoverAll(options = {}, context = {}) {
    const results = [];
    const seenUrls = new Set();

    for (const [name, source] of this.sources.entries()) {
      try {
        const opps = await source.fetchOpportunities(options, context);
        for (const opp of opps) {
          if (!opp.url || seenUrls.has(opp.url)) continue;

          // SSRF Defense Check
          const urlCheck = URLValidator.validate(opp.url);
          if (!urlCheck.safe) {
            console.warn(`[DiscoveryService] Dropped unsafe opportunity URL '${opp.url}':`, urlCheck.error);
            continue;
          }

          seenUrls.add(opp.url);

          let saved = opp;
          if (this.opportunityRepository) {
            saved = await this.opportunityRepository.upsertDiscovered(opp, context);
          }
          results.push(saved);
        }
      } catch (err) {
        console.error(`[DiscoveryService] Error scanning source '${name}':`, err.message);
      }
    }

    return results;
  }
}
