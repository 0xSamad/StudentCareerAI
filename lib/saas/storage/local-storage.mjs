/**
 * local-storage.mjs — Tenant-Partitioned Local File Storage Adapter
 *
 * Implements IStorageService with strict folder-level tenant isolation.
 */

import fs from "node:fs";
import path from "node:path";
import { IStorageService } from "./storage-interface.mjs";
import { PathValidator } from "../security/path-validator.mjs";

export class LocalStorageService extends IStorageService {
  constructor({ baseDir = "data/storage" } = {}) {
    super();
    this.baseDir = baseDir;
  }

  _resolveTenantPath(pathKey, context = {}) {
    const tenantId = context.tenantId || "default";
    const userId = context.userId || "shared";
    const fullDir = path.join(this.baseDir, tenantId, userId);
    const resolved = PathValidator.safeResolve(pathKey, fullDir);

    if (!resolved.safe) {
      throw new Error(`Storage Access Violation: ${resolved.error}`);
    }

    const relativeKey = `${tenantId}/${userId}/${path.relative(fullDir, resolved.resolvedPath).replace(/\\/g, "/")}`;
    return {
      fullDir,
      filePath: resolved.resolvedPath,
      relativeKey,
    };
  }

  async saveFile(pathKey, content, metadata = {}, context = {}) {
    const { fullDir, filePath, relativeKey } = this._resolveTenantPath(pathKey, context);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (Buffer.isBuffer(content) || typeof content === "string") {
      fs.writeFileSync(filePath, content, typeof content === "string" ? "utf-8" : undefined);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
    }

    return {
      key: relativeKey,
      path: filePath,
      size: fs.statSync(filePath).size,
      metadata,
      savedAt: new Date().toISOString(),
    };
  }

  async getFile(pathKey, context = {}) {
    const { filePath } = this._resolveTenantPath(pathKey, context);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${pathKey} for tenant ${context.tenantId || "default"}`);
    }
    return fs.readFileSync(filePath);
  }

  async deleteFile(pathKey, context = {}) {
    const { filePath } = this._resolveTenantPath(pathKey, context);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  async deleteDirectory(dirPathKey, context = {}) {
    const { filePath } = this._resolveTenantPath(dirPathKey, context);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  async deleteUserStorage(context = {}) {
    const tenantId = context.tenantId || "default";
    const userId = context.userId || "shared";
    const userDir = path.join(this.baseDir, tenantId, userId);
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  async getSignedUrl(pathKey, expiresInSeconds = 3600, context = {}) {
    const { relativeKey } = this._resolveTenantPath(pathKey, context);
    return `/api/storage/files/${relativeKey}?expires=${Date.now() + expiresInSeconds * 1000}`;
  }
}
