/**
 * structured-logger.mjs — Production JSON Structured Logger
 *
 * Implements JSON-formatted logging with severity levels (DEBUG, INFO, WARN, ERROR, FATAL),
 * contextual tagging (tenantId, userId, jobId, component), and zero-secret redaction.
 */

import { Sanitizer } from "../auth/sanitizer.mjs";

export const LogLevel = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
});

const LEVEL_NAMES = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.FATAL]: "FATAL",
};

export class StructuredLogger {
  constructor({ minLevel = LogLevel.INFO, defaultComponent = "system" } = {}) {
    this.minLevel = minLevel;
    this.defaultComponent = defaultComponent;
  }

  log(level, message, metadata = {}, context = {}) {
    if (level < this.minLevel) return null;

    const safeMeta = Sanitizer.sanitize(metadata);
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[level] || "INFO",
      message,
      component: context.component || this.defaultComponent,
      tenantId: context.tenantId || "system",
      userId: context.userId || "system",
      jobId: context.jobId || null,
      metadata: safeMeta,
      pid: process.pid,
    };

    const jsonString = JSON.stringify(logEntry);
    if (level >= LogLevel.ERROR) {
      console.error(jsonString);
    } else if (level === LogLevel.WARN) {
      console.warn(jsonString);
    } else {
      console.log(jsonString);
    }

    return logEntry;
  }

  debug(message, metadata = {}, context = {}) {
    return this.log(LogLevel.DEBUG, message, metadata, context);
  }

  info(message, metadata = {}, context = {}) {
    return this.log(LogLevel.INFO, message, metadata, context);
  }

  warn(message, metadata = {}, context = {}) {
    return this.log(LogLevel.WARN, message, metadata, context);
  }

  error(message, metadata = {}, context = {}) {
    return this.log(LogLevel.ERROR, message, metadata, context);
  }

  fatal(message, metadata = {}, context = {}) {
    return this.log(LogLevel.FATAL, message, metadata, context);
  }
}
