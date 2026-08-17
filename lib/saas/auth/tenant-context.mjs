/**
 * tenant-context.mjs — Multi-Tenant Request Context Isolation
 *
 * Enforces strict multi-tenancy across all service layers using Node.js AsyncLocalStorage.
 * Guarantees that no user-specific data or state leaks into global variables.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const asyncLocalStorage = new AsyncLocalStorage();

export class TenantContext {
  /**
   * Run an asynchronous function within a specific tenant & user context.
   *
   * @param {object} context
   * @param {string} context.tenantId - The organization or tenant ID
   * @param {string} context.userId   - The unique user/student ID
   * @param {string} [context.role]   - User role ('student', 'admin', 'reviewer')
   * @param {Function} callback       - The async function to execute
   * @returns {Promise<any>}
   */
  static run(context, callback) {
    if (!context || !context.tenantId || !context.userId) {
      throw new Error("TenantContext.run requires both 'tenantId' and 'userId'");
    }
    const store = {
      tenantId: String(context.tenantId),
      userId: String(context.userId),
      role: context.role || "student",
      metadata: context.metadata || {},
      timestamp: new Date().toISOString(),
    };
    return asyncLocalStorage.run(store, callback);
  }

  /**
   * Get the current active tenant context.
   * Throws an error if called outside an active context (unless allowEmpty is true).
   *
   * @param {boolean} [allowEmpty=false]
   * @returns {object|null}
   */
  static current(allowEmpty = false) {
    const store = asyncLocalStorage.getStore();
    if (!store && !allowEmpty) {
      throw new Error("No active TenantContext found. Operations must run within TenantContext.run()");
    }
    return store || null;
  }

  /**
   * Helper to get active tenantId.
   * @returns {string}
   */
  static getTenantId() {
    return this.current().tenantId;
  }

  /**
   * Helper to get active userId.
   * @returns {string}
   */
  static getUserId() {
    return this.current().userId;
  }
}
