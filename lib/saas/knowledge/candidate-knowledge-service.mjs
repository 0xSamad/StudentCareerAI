/**
 * candidate-knowledge-service.mjs — Candidate Knowledge Base orchestrator.
 *
 * Pipeline: ingest → extract → classify → chunk → embed → structured facts → retrieve.
 * Generated application content must be grounded in retrieved evidence.
 * Missing evidence is UNKNOWN. Never inferred as fact.
 */

import { DOCUMENT_TYPES, EVIDENCE_STATUS, FACT_SOURCES, VERIFICATION_STATUS } from "./document-types.mjs";
import { classifyDocument } from "./classifier.mjs";
import { chunkText } from "./chunker.mjs";
import { embedText, cosineSimilarity } from "./lexical-embedder.mjs";
import { extractDocumentText } from "./text-extractor.mjs";
import { extractCandidateFacts, factsToSourceFacts } from "./fact-extractor.mjs";
import { MemoryKnowledgeStore, newId } from "./knowledge-store.mjs";
import { extractSkills } from "../../../skill-extract.mjs";
import { validateAgainstSourceFacts } from "../../cv-tailor.mjs";
import { shapeCandidateFact, isVerifiedFact } from "./fact-shape.mjs";
import { fetchGitHubEvidence } from "./github-enricher.mjs";
import { enrichLinkedIn } from "./linkedin-enricher.mjs";
import { fetchWebsiteEvidence } from "./website-enricher.mjs";
import { formatEvidenceSnippet, dedupeFactsForDisplay } from "./display-text.mjs";

const MAX_RETRIEVED_CHUNKS = 6;
const MAX_PACKET_CHARS = 2800;
const RETRIEVAL_FLOOR = 0.08;

function requireContext(context = {}) {
  if (!context.tenantId || !context.userId) {
    throw new Error("tenantId and userId are required");
  }
  return context;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function aroundTerms(query, skills = []) {
  const terms = [...skills, ...String(query || "").split(/[^A-Za-z0-9+#./]+/)]
    .map((t) => String(t || "").trim())
    .filter((t) => t.length > 2);
  return [...new Set(terms)].slice(0, 8);
}

function presentRetrieval(query, skills, facts, chunks) {
  const around = aroundTerms(query, skills);
  return {
    evidence: (chunks || []).slice(0, 3).map((chunk) => ({
      ...chunk,
      text: formatEvidenceSnippet(chunk.text, { around, max: 280 }),
    })),
    facts: dedupeFactsForDisplay(facts).slice(0, 8).map((fact) => ({
      ...fact,
      evidence: formatEvidenceSnippet(fact.evidence || fact.snippet, { around: [fact.value, ...around], max: 200 }),
      snippet: formatEvidenceSnippet(fact.snippet || fact.evidence, { around: [fact.value, ...around], max: 160 }),
    })),
  };
}

function attributionSlice(fact = {}) {
  return {
    source: fact.source,
    confidence: fact.confidence,
    timestamp: fact.timestamp || fact.observedAt,
    evidence: fact.evidence || fact.snippet,
    verificationStatus: fact.verificationStatus,
  };
}

export class CandidateKnowledgeService {
  /**
   * @param {{ store?: object, profileRepository?: object, storageService?: object }} [options]
   */
  constructor({ store, profileRepository, storageService, intelligenceService, contextBuilder } = {}) {
    this.store = store || new MemoryKnowledgeStore();
    this.profileRepository = profileRepository || null;
    this.storageService = storageService || null;
    this.intelligenceService = intelligenceService || null;
    this.contextBuilder = contextBuilder || null;
  }

  /**
   * Late-bind intelligence so the container can construct services without a cycle.
   */
  setIntelligence({ intelligenceService = null, contextBuilder = null } = {}) {
    this.intelligenceService = intelligenceService || this.intelligenceService;
    this.contextBuilder = contextBuilder || this.contextBuilder;
  }

  /**
   * Ingest one candidate document. Does not dump the corpus into a prompt.
   */
  async ingestDocument(input = {}, context = {}) {
    const { tenantId, userId } = requireContext(context);
    const extracted = extractDocumentText(input);
    if (extracted.empty) {
      return {
        ok: false,
        status: EVIDENCE_STATUS.UNKNOWN,
        error: input.filename
          ? `No readable text in "${input.filename}". Try a .txt, .md, or .docx file, or paste the text.`
          : "No text could be extracted from this document.",
        warnings: extracted.warnings,
      };
    }

    const classified = classifyDocument({
      filename: input.filename || input.title || "",
      text: extracted.text,
      hintedType: input.type || input.docType,
    });

    const documentId = input.id || newId("doc");
    if (typeof this.store.deleteDocumentContents === "function") {
      await this.store.deleteDocumentContents(documentId, context);
    }
    const title = String(input.title || input.filename || classified.type).slice(0, 255);
    const chunks = chunkText(extracted.text, { documentId, docType: classified.type });
    const chunkRows = chunks.map((chunk) => ({
      id: newId("chk"),
      tenantId,
      userId,
      documentId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      embedding: embedText(chunk.text),
      metadata: { ...chunk.metadata, docType: classified.type },
    }));

    const source = input.source || {
      kind: FACT_SOURCES.USER_DOCUMENT,
      label: classified.type,
      url: input.sourceUrl || null,
    };

    let facts;
    if (Array.isArray(input.facts) && input.facts.length) {
      facts = input.facts.map((fact) =>
        shapeCandidateFact({
          ...fact,
          documentId,
          source: fact.source || source,
        })
      );
    } else {
      facts = extractCandidateFacts({
        text: extracted.text,
        docType: classified.type,
        documentId,
        profile: input.profile || null,
        source,
        verificationStatus: input.verificationStatus || VERIFICATION_STATUS.VERIFIED,
      });
    }

    const factRows = facts.map((fact) => ({
      ...fact,
      id: newId("fct"),
      tenantId,
      userId,
    }));

    await this.store.saveDocument({
      id: documentId,
      tenantId,
      userId,
      docType: classified.type,
      title,
      sourceName: input.filename || input.sourceName || null,
      text: extracted.text,
      metadata: {
        mimeType: input.mimeType || null,
        classification: classified,
        charCount: extracted.text.length,
        chunkCount: chunkRows.length,
        factCount: factRows.length,
      },
    });
    await this.store.saveChunks(chunkRows);
    await this.store.saveFacts(factRows);

    if (this.storageService && (input.buffer || extracted.text)) {
      const pathKey = `knowledge/${documentId}.txt`;
      try {
        await this.storageService.saveFile(pathKey, extracted.text, { docType: classified.type }, context);
      } catch {
        // Storage is optional; the knowledge index is the source of truth.
      }
    }

    return {
      ok: true,
      documentId,
      docType: classified.type,
      classification: classified,
      chunkCount: chunkRows.length,
      factCount: facts.length,
      warnings: extracted.warnings,
      extractedText: extracted.text,
      facts: factRows,
    };
  }

  /**
   * Extract facts from text without requiring persistence (used by tests / preview).
   */
  extractCandidateFacts(input = {}) {
    return extractCandidateFacts({
      text: input.text || "",
      docType: input.type || input.docType || "OTHER",
      documentId: input.documentId || null,
      profile: input.profile || null,
    });
  }

  /**
   * Retrieve only the chunks/facts relevant to a query. Never returns the full corpus.
   */
  async retrieveRelevantEvidence(query, context = {}, { limit = MAX_RETRIEVED_CHUNKS } = {}) {
    requireContext(context);
    const q = String(query || "").trim();
    if (!q) {
      return {
        status: EVIDENCE_STATUS.UNKNOWN,
        query: q,
        evidence: [],
        facts: [],
        reason: "UNKNOWN: empty query.",
      };
    }

    const [chunks, facts] = await Promise.all([
      this.store.listChunks(context),
      this.store.listFacts(context),
    ]);

    const qVec = embedText(q);
    const qLower = q.toLowerCase();
    const querySkills = [...extractSkills(q)].map((s) => s.toLowerCase());

    const scoreChunks = (list, extraFilter) =>
      list
        .filter((chunk) => (extraFilter ? extraFilter(chunk) : true))
        .map((chunk) => {
          const lexical = cosineSimilarity(qVec, chunk.embedding || []);
          const contains = String(chunk.text || "").toLowerCase().includes(qLower) ? 0.15 : 0;
          return { ...chunk, score: lexical + contains };
        })
        .filter((chunk) => chunk.score >= RETRIEVAL_FLOOR)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((chunk) => ({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          score: Number(chunk.score.toFixed(4)),
          metadata: chunk.metadata || {},
        }));

    if (querySkills.length > 0) {
      const matchedFacts = facts.filter((fact) => {
        const n = String(fact.normalizedValue || "").toLowerCase();
        return querySkills.some((skill) => n === skill || n.includes(skill));
      });
      const scored = scoreChunks(chunks, (chunk) =>
        querySkills.some((skill) => String(chunk.text || "").toLowerCase().includes(skill))
      );
      if (scored.length === 0 && matchedFacts.length === 0) {
        return {
          status: EVIDENCE_STATUS.UNKNOWN,
          query: q,
          evidence: [],
          facts: [],
          reason: "UNKNOWN: no supporting evidence in the candidate knowledge base.",
        };
      }
      return {
        status: EVIDENCE_STATUS.GROUNDED,
        query: q,
        ...presentRetrieval(q, querySkills, matchedFacts, scored),
        fullCorpusIncluded: false,
      };
    }

    const stop = new Set(["what", "evidence", "have", "that", "this", "student", "knows", "does", "about", "which", "information", "demonstrate"]);
    const queryTokens = qLower.split(/[^a-z0-9+#.]+/).filter((t) => t.length > 3 && !stop.has(t));
    const matchedFacts = facts.filter((fact) => {
      const n = String(fact.normalizedValue || "").toLowerCase();
      const snippet = String(fact.snippet || "").toLowerCase();
      if (!n) return false;
      if (qLower.includes(n) || n.includes(qLower)) return true;
      return queryTokens.some((t) => n.includes(t) || snippet.includes(t));
    });
    const scored = scoreChunks(chunks);

    if (scored.length === 0 && matchedFacts.length === 0) {
      return {
        status: EVIDENCE_STATUS.UNKNOWN,
        query: q,
        evidence: [],
        facts: [],
        reason: "UNKNOWN: no supporting evidence in the candidate knowledge base.",
      };
    }

    return {
      status: EVIDENCE_STATUS.GROUNDED,
      query: q,
      ...presentRetrieval(q, queryTokens, matchedFacts, scored),
      fullCorpusIncluded: false,
    };
  }

  /**
   * Compact, retrieved-only evidence packet. Never concatenates all documents.
   * Used by CandidateContextBuilder — do not call the builder from here.
   */
  async buildEvidenceContext(opportunity = {}, context = {}) {
    requireContext(context);
    const title = opportunity.title || opportunity.role || "";
    const description = opportunity.description || opportunity.raw_text || "";
    const required = uniqueBy(
      [
        ...extractSkills(`${title}\n${description}`),
        ...(Array.isArray(opportunity.required_skills) ? opportunity.required_skills : []),
        ...(Array.isArray(opportunity.skills) ? opportunity.skills : []),
      ],
      (s) => String(s).toLowerCase()
    );

    const allFacts = await this.store.listFacts(context);
    const skillFacts = allFacts.filter((f) => f.factType === "skill" || f.factType === "technology");
    const projectFacts = allFacts.filter((f) => f.factType === "project");
    const companyFacts = allFacts.filter((f) => f.factType === "company" || f.factType === "role");
    const eduFacts = allFacts.filter((f) => ["education", "degree", "major", "coursework"].includes(f.factType));

    const matchingSkills = [];
    const uncertainSkills = [];
    const missingSkills = [];
    for (const skill of required) {
      const n = String(skill).toLowerCase();
      const hits = skillFacts.filter((f) => f.normalizedValue === n || f.normalizedValue.includes(n) || n.includes(f.normalizedValue));
      const verified = hits.filter(isVerifiedFact);
      if (verified.length) matchingSkills.push({ skill, status: EVIDENCE_STATUS.GROUNDED, evidence: verified.slice(0, 3) });
      else if (hits.length) uncertainSkills.push({ skill, status: EVIDENCE_STATUS.UNCERTAIN, evidence: hits.slice(0, 3) });
      else missingSkills.push({ skill, status: EVIDENCE_STATUS.UNKNOWN });
    }

    const retrieved = await this.retrieveRelevantEvidence(
      `${title} ${description}`.slice(0, 2500),
      context,
      { limit: MAX_RETRIEVED_CHUNKS }
    );

    const packets = [];
    let used = 0;
    for (const chunk of retrieved.evidence || []) {
      if (used + chunk.text.length > MAX_PACKET_CHARS) break;
      packets.push(chunk);
      used += chunk.text.length;
    }

    const oppBlob = `${title} ${description}`.toLowerCase();
    const matchingProjects = projectFacts
      .filter((f) => oppBlob.includes(f.normalizedValue) || (retrieved.evidence || []).some((c) => String(c.text).toLowerCase().includes(f.normalizedValue)))
      .slice(0, 8);
    const matchingExperience = companyFacts
      .filter((f) => oppBlob.includes(f.normalizedValue) || (retrieved.evidence || []).some((c) => String(c.text).toLowerCase().includes(f.normalizedValue)))
      .slice(0, 8);

    const education = this._educationAgainstOpportunity(opportunity, eduFacts);

    const missingInformation = [
      ...missingSkills.map((s) => ({ field: `skill:${s.skill}`, status: EVIDENCE_STATUS.UNKNOWN })),
      ...education.unknown.map((item) => ({ field: item.field, status: EVIDENCE_STATUS.UNKNOWN })),
    ];

    const documents = await this.store.listDocuments(context);
    if (!documents.some((d) => d.docType === "TRANSCRIPT") && /gpa|transcript/i.test(description)) {
      missingInformation.push({ field: "transcript", status: EVIDENCE_STATUS.UNKNOWN });
    }

    return {
      fullCorpusIncluded: false,
      documentCount: documents.length,
      retrievedChunkCount: packets.length,
      matchingSkills,
      uncertainSkills,
      missingSkills,
      matchingProjects,
      matchingExperience,
      technologiesUsed: uniqueBy(
        skillFacts.map((f) => ({
          value: f.value,
          status: isVerifiedFact(f) ? EVIDENCE_STATUS.GROUNDED : EVIDENCE_STATUS.UNCERTAIN,
          snippet: f.evidence || f.snippet,
          source: f.source,
          confidence: f.confidence,
          timestamp: f.timestamp || f.observedAt,
          evidence: f.evidence || f.snippet,
          verificationStatus: f.verificationStatus,
        })),
        (x) => x.value.toLowerCase()
      ),
      education,
      evidencePackets: packets,
      missingInformation,
      status: packets.length || matchingSkills.length ? EVIDENCE_STATUS.GROUNDED : EVIDENCE_STATUS.UNKNOWN,
    };
  }

  /**
   * Opportunity-specific candidate context. Uses CandidateContextBuilder when bound
   * so engines receive preferences, corrections, and approved answers — not the corpus.
   */
  async getCandidateContextForOpportunity(opportunity = {}, context = {}, options = {}) {
    requireContext(context);
    if (this.contextBuilder) {
      return this.contextBuilder.build(opportunity, context, options);
    }
    return this.buildEvidenceContext(opportunity, context);
  }

  _educationAgainstOpportunity(opportunity, eduFacts) {
    const blob = `${opportunity.title || ""} ${opportunity.description || ""} ${opportunity.requirements || ""}`;
    const satisfied = [];
    const unknown = [];
    const wantsBachelor = /\bbachelor|b\.?s\.?|undergraduate\b/i.test(blob);
    const wantsMaster = /\bmaster|m\.?s\.?|graduate\s+degree\b/i.test(blob);
    const wantsCs = /computer\s+science|software\s+engineering|cs\s+major/i.test(blob);

    const degrees = eduFacts.filter((f) => f.factType === "degree");
    const majors = eduFacts.filter((f) => f.factType === "major");
    const schools = eduFacts.filter((f) => f.factType === "education");

    if (wantsBachelor) {
      const hit = degrees.find((d) => /bachelor|b\.?s|bsc|undergraduate/i.test(d.value));
      if (hit) satisfied.push({ field: "degree", requirement: "bachelor", status: EVIDENCE_STATUS.GROUNDED, evidence: hit });
      else if (degrees.length === 0) unknown.push({ field: "degree", requirement: "bachelor", status: EVIDENCE_STATUS.UNKNOWN });
    }
    if (wantsMaster) {
      const hit = degrees.find((d) => /master|m\.?s|msc|mba/i.test(d.value));
      if (hit) satisfied.push({ field: "degree", requirement: "master", status: EVIDENCE_STATUS.GROUNDED, evidence: hit });
      else unknown.push({ field: "degree", requirement: "master", status: EVIDENCE_STATUS.UNKNOWN });
    }
    if (wantsCs) {
      const hit = majors.find((d) => /computer|software|informatics|data\s+science/i.test(d.value));
      if (hit) satisfied.push({ field: "major", requirement: "computer science", status: EVIDENCE_STATUS.GROUNDED, evidence: hit });
      else if (majors.length === 0) unknown.push({ field: "major", requirement: "computer science", status: EVIDENCE_STATUS.UNKNOWN });
    }
    if (!schools.length && /university|enrolled|student\s+status/i.test(blob)) {
      unknown.push({ field: "education", status: EVIDENCE_STATUS.UNKNOWN });
    }

    return { satisfied, unknown, facts: eduFacts.slice(0, 12) };
  }

  /**
   * Validate generated application text/draft against attested evidence.
   * Fabricated companies/projects/metrics → REJECTED.
   * Skills/tech with no evidence → UNKNOWN (not treated as fact).
   */
  async validateGeneratedClaim(claim, context = {}) {
    requireContext(context);
    const allFacts = await this.store.listFacts(context);
    const sourceFacts = factsToSourceFacts(allFacts, { verifiedOnly: true });
    const isObject = claim && typeof claim === "object" && !Array.isArray(claim);
    const text = isObject
      ? [claim.summary, claim.body, ...(claim.competencies || []), JSON.stringify(claim.experience || []), JSON.stringify(claim.projects || [])]
          .filter(Boolean)
          .join("\n")
      : String(claim || "");

    const tailor = validateAgainstSourceFacts(isObject ? claim : text, sourceFacts);

    const claimedSkills = [...extractSkills(text)];
    const groundedClaims = [];
    const unknownClaims = [];
    const uncertainClaims = [];
    for (const skill of claimedSkills) {
      const n = skill.toLowerCase();
      const hits = allFacts.filter(
        (f) => (f.factType === "skill" || f.factType === "technology") && (f.normalizedValue === n || f.normalizedValue.includes(n))
      );
      const verified = hits.filter(isVerifiedFact);
      if (verified.length) {
        groundedClaims.push({
          skill,
          status: EVIDENCE_STATUS.GROUNDED,
          snippet: verified[0].evidence || verified[0].snippet,
          ...attributionSlice(verified[0]),
        });
      } else if (hits.length) {
        uncertainClaims.push({
          skill,
          status: EVIDENCE_STATUS.UNCERTAIN,
          reason: `${skill} appears only as UNCERTAIN evidence (not treated as verified).`,
          ...attributionSlice(hits[0]),
        });
      } else {
        unknownClaims.push({ skill, status: EVIDENCE_STATUS.UNKNOWN, reason: `No evidence that the candidate knows ${skill}.` });
      }
    }

    const fabricated = tailor.violations || [];
    let status = EVIDENCE_STATUS.GROUNDED;
    let result = "CLEAN";
    if (fabricated.length) {
      status = EVIDENCE_STATUS.REJECTED;
      result = "REJECTED";
    } else if (unknownClaims.length) {
      status = EVIDENCE_STATUS.UNKNOWN;
      result = "UNKNOWN";
    } else if (uncertainClaims.length) {
      status = EVIDENCE_STATUS.UNCERTAIN;
      result = "UNCERTAIN";
    }

    return {
      valid: fabricated.length === 0 && unknownClaims.length === 0 && uncertainClaims.length === 0,
      status,
      result,
      violations: fabricated,
      unknownClaims,
      uncertainClaims,
      groundedClaims,
      flagged: tailor.flagged || [],
    };
  }

  async listKnowledge(context = {}) {
    requireContext(context);
    const [documents, facts] = await Promise.all([
      this.store.listDocuments(context),
      this.store.listFacts(context),
    ]);
    const missing = this._missingProfileSignals(facts, documents);
    return {
      documents: documents.map((d) => ({
        id: d.id,
        docType: d.docType,
        title: d.title,
        sourceName: d.sourceName,
        createdAt: d.createdAt,
        charCount: d.metadata?.charCount || String(d.text || "").length,
        chunkCount: d.metadata?.chunkCount || null,
        factCount: d.metadata?.factCount || null,
      })),
      factCount: facts.length,
      documentTypes: DOCUMENT_TYPES,
      technologies: uniqueBy(
        facts
          .filter((f) => (f.factType === "technology" || f.factType === "skill") && isVerifiedFact(f))
          .map((f) => f.value),
        (v) => v.toLowerCase()
      ),
      uncertainTechnologies: uniqueBy(
        facts
          .filter((f) => (f.factType === "technology" || f.factType === "skill") && !isVerifiedFact(f))
          .map((f) => f.value),
        (v) => v.toLowerCase()
      ),
      missingInformation: missing,
    };
  }

  _missingProfileSignals(facts, documents) {
    const missing = [];
    const has = (type) => facts.some((f) => f.factType === type);
    if (!has("skill") && !has("technology")) missing.push({ field: "skills", status: EVIDENCE_STATUS.UNKNOWN });
    if (!has("project")) missing.push({ field: "projects", status: EVIDENCE_STATUS.UNKNOWN });
    if (!has("company") && !has("role")) missing.push({ field: "experience", status: EVIDENCE_STATUS.UNKNOWN });
    if (!has("education") && !has("degree")) missing.push({ field: "education", status: EVIDENCE_STATUS.UNKNOWN });
    if (!documents.some((d) => d.docType === "TRANSCRIPT")) missing.push({ field: "transcript", status: EVIDENCE_STATUS.UNKNOWN });
    if (!has("certificate") && !documents.some((d) => d.docType === "CERTIFICATE")) {
      missing.push({ field: "certificates", status: EVIDENCE_STATUS.UNKNOWN });
    }
    return missing;
  }

  /**
   * Seed the knowledge base from the structured student profile + master CV.
   * Idempotent per user: replaces the previous profile-seed document.
   */
  async seedFromProfile(profile, cvText, context = {}) {
    requireContext(context);
    const existing = await this.store.listDocuments(context);
    const prior = existing.find((d) => d.sourceName === "profile-seed");
    const result = await this.ingestDocument(
      {
        id: prior?.id,
        type: "CV",
        title: "Structured student profile",
        filename: "profile-seed",
        sourceName: "profile-seed",
        source: { kind: FACT_SOURCES.PROFILE_SEED, label: "Structured student profile" },
        text: [
          cvText || "",
          profile?.identity?.name ? `Name: ${profile.identity.name}` : "",
          JSON.stringify(
            {
              education: profile?.education || [],
              skills: profile?.skills || {},
              experience: profile?.experience || {},
              projects: profile?.projects || [],
            },
            null,
            2
          ),
        ].join("\n\n"),
        profile,
      },
      context
    );
    if (this.intelligenceService && typeof this.intelligenceService.syncFromTrustedProfile === "function") {
      await this.intelligenceService.syncFromTrustedProfile(profile, context).catch(() => null);
    }
    return result;
  }

  /**
   * Enrich from a user-authorized external source (GitHub API, LinkedIn paste, portfolio/website).
   * Never bypasses authentication, private profiles, CAPTCHA, or rate limits.
   */
  async enrichFromExternalProfile(input = {}, context = {}) {
    requireContext(context);
    const kind = String(input.source || input.kind || "").toLowerCase();
    let result;

    if (kind === "github") {
      result = await fetchGitHubEvidence({
        url: input.url,
        username: input.username,
        token: input.token,
        fetchFn: input.fetchFn,
      });
    } else if (kind === "linkedin") {
      result = enrichLinkedIn({ url: input.url, text: input.text });
    } else if (kind === "portfolio" || kind === "website") {
      result = await fetchWebsiteEvidence({
        url: input.url,
        kind: kind === "portfolio" ? "portfolio" : "website",
        fetchFn: input.fetchFn,
      });
    } else {
      return {
        ok: false,
        status: EVIDENCE_STATUS.UNKNOWN,
        reason: "UNKNOWN: source must be github, linkedin, portfolio, or website.",
      };
    }

    if (!result.ok) {
      if (result.facts?.length) {
        const existing = await this.store.listDocuments(context);
        const prior = existing.find((d) => d.sourceName === `enrich:${kind}`);
        await this.ingestDocument(
          {
            id: prior?.id,
            type: kind === "linkedin" ? "LINKEDIN" : kind === "github" ? "GITHUB" : "PORTFOLIO",
            title: `Enrichment ${kind}`,
            filename: `enrich:${kind}`,
            sourceName: `enrich:${kind}`,
            text: result.text || String(input.url || kind),
            facts: result.facts,
            source: result.facts[0]?.source,
          },
          context
        );
      }
      return result;
    }

    const existing = await this.store.listDocuments(context);
    const prior = existing.find((d) => d.sourceName === `enrich:${kind}`);
    const ingested = await this.ingestDocument(
      {
        id: prior?.id,
        type: kind === "linkedin" ? "LINKEDIN" : kind === "github" ? "GITHUB" : kind === "portfolio" ? "PORTFOLIO" : "OTHER",
        title: kind === "github" ? `GitHub @${result.username}` : `${kind} enrichment`,
        filename: `enrich:${kind}`,
        sourceName: `enrich:${kind}`,
        text: result.text,
        facts: result.facts,
        source: result.facts[0]?.source,
      },
      context
    );

    await this._persistIdentityUrl(
      kind,
      result.profileUrl || result.url || input.url || (result.username ? `https://github.com/${result.username}` : ""),
      context
    );

    return {
      ...result,
      ...ingested,
      tokenStored: false,
    };
  }

  async enrichFromProfileLinks(profile = {}, context = {}, extras = {}) {
    const identity = profile.identity || {};
    const outputs = [];
    if (identity.github) {
      outputs.push(await this.enrichFromExternalProfile({ source: "github", url: identity.github, token: extras.githubToken, fetchFn: extras.fetchFn }, context));
    }
    if (identity.linkedin) {
      outputs.push(await this.enrichFromExternalProfile({ source: "linkedin", url: identity.linkedin, text: extras.linkedinText }, context));
    }
    if (identity.portfolio) {
      outputs.push(await this.enrichFromExternalProfile({ source: "portfolio", url: identity.portfolio, fetchFn: extras.fetchFn }, context));
    }
    return outputs;
  }

  async _persistIdentityUrl(kind, url, context = {}) {
    const href = String(url || "").trim();
    if (!href || !this.profileRepository) return;
    try {
      const stored = (await this.profileRepository.getByUserId(context.userId, context.tenantId)) || {};
      const identity = { ...(stored.identity || {}) };
      if (kind === "github") identity.github = href;
      else if (kind === "linkedin") identity.linkedin = href;
      else if (kind === "portfolio" || kind === "website") identity.portfolio = href;
      else return;
      await this.profileRepository.upsertProfile(context.userId, context.tenantId, {
        ...stored,
        identity,
        cvText: stored.cvText,
      });
    } catch {
      /* Profile sync is best-effort; knowledge ingest already succeeded. */
    }
  }

  async deleteUserData(context = {}) {
    requireContext(context);
    if (typeof this.store.deleteUserData === "function") {
      await this.store.deleteUserData(context);
    }
    if (this.intelligenceService && typeof this.intelligenceService.deleteUserData === "function") {
      try {
        await this.intelligenceService.deleteUserData(context);
      } catch {
        /* missing table or store must not block erasure of knowledge */
      }
    }
  }
}

export { DOCUMENT_TYPES, EVIDENCE_STATUS };
