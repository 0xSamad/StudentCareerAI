/**
 * storage-interface.mjs — Pluggable Storage Service Interface
 *
 * Defines contracts for file and artifact storage (CVs, cover letters, PDFs).
 */

export class IStorageService {
  async saveFile(pathKey, bufferOrString, metadata, context) {
    throw new Error("Method not implemented");
  }

  async getFile(pathKey, context) {
    throw new Error("Method not implemented");
  }

  async deleteFile(pathKey, context) {
    throw new Error("Method not implemented");
  }

  async getSignedUrl(pathKey, expiresInSeconds, context) {
    throw new Error("Method not implemented");
  }
}
