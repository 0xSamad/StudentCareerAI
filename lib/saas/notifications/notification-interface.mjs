/**
 * notification-interface.mjs — Notification Service Contracts
 *
 * Defines contracts for multi-channel student alerts and audit notifications.
 */

export class INotificationChannel {
  constructor(name) {
    this.name = name;
  }

  async send({ recipient, subject, body, metadata }, context) {
    throw new Error("Method not implemented");
  }
}

export class INotificationService {
  registerChannel(channel) {
    throw new Error("Method not implemented");
  }

  async notify(notification, context) {
    throw new Error("Method not implemented");
  }

  async getInAppNotifications(userId, tenantId) {
    throw new Error("Method not implemented");
  }
}
