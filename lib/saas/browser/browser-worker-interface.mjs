/**
 * browser-worker-interface.mjs — Browser Automation Worker Contracts
 *
 * Defines contracts for headless browser workers with strict safety invariants.
 */

export class IBrowserWorker {
  async executeApplication({ opportunity, answers, attachments, autoSubmit }, context) {
    throw new Error("Method not implemented");
  }

  async validateFormFields(pageUrl, context) {
    throw new Error("Method not implemented");
  }
}

export class IBrowserPool {
  async acquireWorker(context) {
    throw new Error("Method not implemented");
  }

  async releaseWorker(worker, context) {
    throw new Error("Method not implemented");
  }
}
