/**
 * path-validator.mjs — Path Traversal Defense & Secure File Upload Validator
 *
 * Prevents Directory Traversal attacks (e.g. `../../etc/passwd`), restricts file extensions,
 * and validates file sizes for uploaded student CVs and documents.
 */

import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".md", ".txt", ".html", ".tex", ".json", ".png", ".jpg"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export class PathValidator {
  /**
   * Validate and resolve safe path within base boundary directory.
   *
   * @param {string} relativePath - Target relative path
   * @param {string} baseDir - Mandatory root boundary directory
   * @returns {{ safe: boolean, error: string|null, resolvedPath: string|null }}
   */
  static safeResolve(relativePath, baseDir) {
    if (!relativePath || typeof relativePath !== "string") {
      return { safe: false, error: "Invalid path provided", resolvedPath: null };
    }

    const clean = relativePath.replace(/^[\/\\]+/, "");
    const resolved = path.resolve(baseDir, clean);
    const normalizedBase = path.resolve(baseDir);

    if (!resolved.startsWith(normalizedBase)) {
      return {
        safe: false,
        error: `Path traversal detected: target path '${relativePath}' attempts to escape base directory`,
        resolvedPath: null,
      };
    }

    return { safe: true, error: null, resolvedPath: resolved };
  }

  /**
   * Validate file upload metadata and contents.
   *
   * @param {object} file - { filename, size, mimeType }
   * @returns {{ safe: boolean, error: string|null, sanitizedFilename: string|null }}
   */
  static validateUpload({ filename = "", size = 0 } = {}) {
    const ext = path.extname(filename).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        safe: false,
        error: `Disallowed file extension '${ext}'. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
        sanitizedFilename: null,
      };
    }

    if (size > MAX_FILE_SIZE_BYTES) {
      return {
        safe: false,
        error: `File size exceeds 10MB maximum limit (${(size / 1024 / 1024).toFixed(2)} MB)`,
        sanitizedFilename: null,
      };
    }

    // Sanitize filename removing control characters and path symbols
    const sanitizedFilename = path.basename(filename).replace(/[^a-zA-Z0-9_\.\-]/g, "_");
    return { safe: true, error: null, sanitizedFilename };
  }
}
