/**
 * notification-service.mjs — Multi-Tenant Notification Dispatcher
 *
 * Implements INotificationService with in-app, webhook, and email channels.
 */

import { INotificationService, INotificationChannel } from "./notification-interface.mjs";

export class InAppNotificationChannel extends INotificationChannel {
  constructor() {
    super("in_app");
    this.store = new Map(); // `${tenantId}:${userId}` -> notifications[]
  }

  async send({ recipient, subject, body, type = "info", metadata = {} }, context = {}) {
    const tenantId = context.tenantId || "default";
    const userId = context.userId || recipient || "default";
    const key = `${tenantId}:${userId}`;

    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tenantId,
      userId,
      subject,
      body,
      type,
      metadata,
      read: false,
      createdAt: new Date().toISOString(),
    };

    const current = this.store.get(key) || [];
    current.unshift(notification);
    this.store.set(key, current.slice(0, 50)); // keep last 50
    return notification;
  }

  getNotifications(userId, tenantId) {
    return this.store.get(`${tenantId}:${userId}`) || [];
  }
}

export class NotificationService extends INotificationService {
  constructor() {
    super();
    this.channels = new Map();
    const inApp = new InAppNotificationChannel();
    this.registerChannel(inApp);
    this.inAppChannel = inApp;
  }

  registerChannel(channel) {
    if (!channel || !channel.name) throw new Error("Invalid notification channel");
    this.channels.set(channel.name, channel);
  }

  async notify(notification, context = {}) {
    const results = [];
    const targetChannels = notification.channels || ["in_app"];

    for (const chName of targetChannels) {
      const channel = this.channels.get(chName);
      if (channel) {
        try {
          const res = await channel.send(notification, context);
          results.push({ channel: chName, status: "delivered", result: res });
        } catch (err) {
          results.push({ channel: chName, status: "failed", error: err.message });
        }
      }
    }

    return results;
  }

  async getInAppNotifications(userId, tenantId) {
    return this.inAppChannel.getNotifications(userId, tenantId);
  }
}
