/**
 * knowledge-store.mjs — Per-user Candidate Knowledge Base persistence.
 * Memory store for tests / offline. Postgres store when DATABASE_URL is set.
 */

import { randomUUID } from "node:crypto";

export function newId(prefix = "kb") {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`.slice(0, 64);
}

function matchesUser(row, context) {
  return row.tenantId === context.tenantId && row.userId === context.userId;
}

export class MemoryKnowledgeStore {
  constructor() {
    this.documents = new Map();
    this.chunks = new Map();
    this.facts = new Map();
  }

  async saveDocument(doc) {
    this.documents.set(doc.id, { ...doc, deletedAt: null });
    return this.documents.get(doc.id);
  }

  async saveChunks(chunks = []) {
    for (const chunk of chunks) this.chunks.set(chunk.id, { ...chunk });
    return chunks.length;
  }

  async saveFacts(facts = []) {
    for (const fact of facts) this.facts.set(fact.id, { ...fact });
    return facts.length;
  }

  async listDocuments(context) {
    return [...this.documents.values()].filter((d) => matchesUser(d, context) && !d.deletedAt);
  }

  async getDocument(id, context) {
    const doc = this.documents.get(id);
    if (!doc || !matchesUser(doc, context) || doc.deletedAt) return null;
    return doc;
  }

  async listChunks(context) {
    return [...this.chunks.values()].filter((c) => matchesUser(c, context));
  }

  async listFacts(context, { factType } = {}) {
    return [...this.facts.values()].filter((f) => {
      if (!matchesUser(f, context)) return false;
      if (factType && f.factType !== factType) return false;
      return true;
    });
  }

  async deleteDocumentContents(documentId, context) {
    for (const [id, chunk] of this.chunks) {
      if (matchesUser(chunk, context) && chunk.documentId === documentId) this.chunks.delete(id);
    }
    for (const [id, fact] of this.facts) {
      if (matchesUser(fact, context) && fact.documentId === documentId) this.facts.delete(id);
    }
  }

  async deleteUserData(context) {
    for (const [id, doc] of this.documents) {
      if (matchesUser(doc, context)) this.documents.delete(id);
    }
    for (const [id, chunk] of this.chunks) {
      if (matchesUser(chunk, context)) this.chunks.delete(id);
    }
    for (const [id, fact] of this.facts) {
      if (matchesUser(fact, context)) this.facts.delete(id);
    }
  }
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class PgKnowledgeStore {
  constructor(client) {
    this.client = client;
  }

  async saveDocument(doc) {
    await this.client.query(
      `INSERT INTO candidate_documents (
         id, tenant_id, user_id, doc_type, title, source_name, text, metadata, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
       ON CONFLICT (id) DO UPDATE SET
         doc_type = EXCLUDED.doc_type,
         title = EXCLUDED.title,
         source_name = EXCLUDED.source_name,
         text = EXCLUDED.text,
         metadata = EXCLUDED.metadata,
         deleted_at = NULL`,
      [
        doc.id,
        doc.tenantId,
        doc.userId,
        doc.docType,
        doc.title,
        doc.sourceName || null,
        doc.text,
        JSON.stringify(doc.metadata || {}),
      ]
    );
    return doc;
  }

  async saveChunks(chunks = []) {
    for (const chunk of chunks) {
      await this.client.query(
        `INSERT INTO candidate_chunks (
           id, tenant_id, user_id, document_id, ordinal, text, embedding, metadata, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NOW())
         ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding`,
        [
          chunk.id,
          chunk.tenantId,
          chunk.userId,
          chunk.documentId,
          chunk.ordinal,
          chunk.text,
          JSON.stringify(chunk.embedding || []),
          JSON.stringify(chunk.metadata || {}),
        ]
      );
    }
    return chunks.length;
  }

  async saveFacts(facts = []) {
    for (const fact of facts) {
      await this.client.query(
        `INSERT INTO candidate_facts (
           id, tenant_id, user_id, document_id, fact_type, value, normalized_value, snippet, confidence,
           source, source_url, evidence, observed_at, verification_status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, snippet = EXCLUDED.snippet,
           evidence = EXCLUDED.evidence, source = EXCLUDED.source, verification_status = EXCLUDED.verification_status`,
        [
          fact.id,
          fact.tenantId,
          fact.userId,
          fact.documentId || null,
          fact.factType,
          fact.value,
          fact.normalizedValue,
          fact.snippet,
          fact.confidence ?? 1,
          typeof fact.source === "object" ? fact.source.kind : (fact.source || "user_document"),
          fact.sourceUrl || fact.source?.url || null,
          fact.evidence || fact.snippet || fact.value,
          fact.timestamp || fact.observedAt || new Date().toISOString(),
          fact.verificationStatus || "VERIFIED",
        ]
      );
    }
    return facts.length;
  }

  async listDocuments(context) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId", doc_type AS "docType",
              title, source_name AS "sourceName", text, metadata, created_at AS "createdAt"
       FROM candidate_documents
       WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [context.tenantId, context.userId]
    );
    return rows.map((r) => ({ ...r, metadata: parseJson(r.metadata, {}) }));
  }

  async getDocument(id, context) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId", doc_type AS "docType",
              title, source_name AS "sourceName", text, metadata, created_at AS "createdAt"
       FROM candidate_documents
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [id, context.tenantId, context.userId]
    );
    return rows[0] ? { ...rows[0], metadata: parseJson(rows[0].metadata, {}) } : null;
  }

  async listChunks(context) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId", document_id AS "documentId",
              ordinal, text, embedding, metadata
       FROM candidate_chunks
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY ordinal ASC`,
      [context.tenantId, context.userId]
    );
    return rows.map((r) => ({
      ...r,
      embedding: parseJson(r.embedding, []),
      metadata: parseJson(r.metadata, {}),
    }));
  }

  async listFacts(context, { factType } = {}) {
    const params = [context.tenantId, context.userId];
    let sql = `SELECT id, tenant_id AS "tenantId", user_id AS "userId", document_id AS "documentId",
                      fact_type AS "factType", value, normalized_value AS "normalizedValue",
                      snippet, confidence, source, source_url AS "sourceUrl", evidence,
                      observed_at AS "observedAt", verification_status AS "verificationStatus"
               FROM candidate_facts
               WHERE tenant_id = $1 AND user_id = $2`;
    if (factType) {
      params.push(factType);
      sql += ` AND fact_type = $${params.length}`;
    }
    const { rows } = await this.client.query(sql, params);
    return rows.map((r) => ({
      ...r,
      source: { kind: r.source || "user_document", label: r.source || "user_document", url: r.sourceUrl || null },
      evidence: r.evidence || r.snippet,
      timestamp: r.observedAt,
      verificationStatus: r.verificationStatus || "VERIFIED",
    }));
  }

  async deleteDocumentContents(documentId, context) {
    await this.client.query(
      `DELETE FROM candidate_chunks WHERE tenant_id = $1 AND user_id = $2 AND document_id = $3`,
      [context.tenantId, context.userId, documentId]
    );
    await this.client.query(
      `DELETE FROM candidate_facts WHERE tenant_id = $1 AND user_id = $2 AND document_id = $3`,
      [context.tenantId, context.userId, documentId]
    );
  }

  async deleteUserData(context) {
    await this.client.query(
      `DELETE FROM candidate_chunks WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, context.userId]
    );
    await this.client.query(
      `DELETE FROM candidate_facts WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, context.userId]
    );
    await this.client.query(
      `DELETE FROM candidate_documents WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, context.userId]
    );
  }
}
