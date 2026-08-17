/**
 * env-config.mjs — Production Environment Configuration Manager
 *
 * Provides typed, validated, and environment-separated configuration
 * for database, AI providers, storage, email, authentication, payments, and monitoring.
 */

import { Sanitizer } from "../auth/sanitizer.mjs";

export class EnvConfig {
  constructor(env = process.env) {
    this.nodeEnv = env.NODE_ENV || "development";
    this.isProduction = this.nodeEnv === "production";
    this.isTesting = this.nodeEnv === "test" || this.nodeEnv === "testing";
    this.isDevelopment = !this.isProduction && !this.isTesting;

    // 1. Database Configuration
    this.database = {
      url: env.DATABASE_URL || "postgresql://career_user:career_pass@localhost:5432/career_ops",
      host: env.POSTGRES_HOST || "localhost",
      port: parseInt(env.POSTGRES_PORT || "5432", 10),
      user: env.POSTGRES_USER || "career_user",
      password: env.POSTGRES_PASSWORD || "career_pass",
      database: env.POSTGRES_DB || "career_ops",
      ssl: env.DATABASE_SSL === "true" || env.DATABASE_SSL === "1",
      maxPoolSize: parseInt(env.DATABASE_MAX_POOL || "20", 10),
    };

    // 2. AI Providers Configuration
    this.ai = {
      defaultProvider: env.DEFAULT_AI_PROVIDER || "openai",
      defaultModel: env.DEFAULT_AI_MODEL || "gpt-5.6-luna",
      openrouterApiKey: env.OPENROUTER_API_KEY || "",
      openaiApiKey: env.OPENAI_API_KEY || "",
      anthropicApiKey: env.ANTHROPIC_API_KEY || "",
      temperature: parseFloat(env.AI_TEMPERATURE || "0.2"),
      timeoutMs: parseInt(env.AI_TIMEOUT_MS || "30000", 10),
    };

    // 3. Storage Configuration
    this.storage = {
      driver: env.STORAGE_DRIVER || "local", // 'local' | 's3'
      localDir: env.LOCAL_STORAGE_DIR || "data/storage",
      s3Bucket: env.S3_BUCKET || "",
      s3Region: env.S3_REGION || "us-east-1",
      awsAccessKeyId: env.AWS_ACCESS_KEY_ID || "",
      awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY || "",
    };

    // 4. Email Configuration
    this.email = {
      host: env.SMTP_HOST || "smtp.sendgrid.net",
      port: parseInt(env.SMTP_PORT || "587", 10),
      user: env.SMTP_USER || "apikey",
      password: env.SMTP_PASSWORD || env.SENDGRID_API_KEY || "",
      from: env.SMTP_FROM || "notifications@studentcareer.ai",
      secure: env.SMTP_SECURE === "true",
    };

    // 5. Authentication Configuration
    this.auth = {
      sessionSecret: env.SESSION_SECRET || (this.isProduction ? "" : "dev_session_secret_32_chars_long_1234"),
      jwtSecret: env.JWT_SECRET || (this.isProduction ? "" : "dev_jwt_secret_32_chars_long_1234567"),
      csrfSecret: env.CSRF_SECRET || (this.isProduction ? "" : "dev_csrf_secret_32_chars_long_1234"),
      sessionTtlHours: parseInt(env.SESSION_TTL_HOURS || "24", 10),
      passwordSaltRounds: parseInt(env.PASSWORD_SALT_ROUNDS || "12", 10),
    };

    // 6. Payment Provider Configuration
    this.payment = {
      stripeSecretKey: env.STRIPE_SECRET_KEY || "",
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
      stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "",
    };

    // 7. Monitoring & Telemetry Configuration
    this.monitoring = {
      logLevel: env.LOG_LEVEL || (this.isProduction ? "info" : "debug"),
      sentryDsn: env.SENTRY_DSN || "",
      metricsPort: parseInt(env.METRICS_PORT || "9090", 10),
      enableTelemetry: env.ENABLE_TELEMETRY === "true" || this.isProduction,
    };

    // 8. Server Ports
    this.server = {
      port: parseInt(env.PORT || "3000", 10),
      apiPort: parseInt(env.API_PORT || "4000", 10),
      host: env.HOST || "0.0.0.0",
    };

    if (this.isProduction) {
      this.validateProductionRequirements();
    }
  }

  validateProductionRequirements() {
    const missing = [];
    if (!this.auth.sessionSecret || this.auth.sessionSecret.includes("dev_")) {
      missing.push("SESSION_SECRET (must be cryptographically secure in production)");
    }
    if (!this.auth.jwtSecret || this.auth.jwtSecret.includes("dev_")) {
      missing.push("JWT_SECRET (must be cryptographically secure in production)");
    }
    return { valid: missing.length === 0, missing };
  }

  toSafeJSON() {
    return Sanitizer.sanitize({
      nodeEnv: this.nodeEnv,
      isProduction: this.isProduction,
      database: {
        host: this.database.host,
        port: this.database.port,
        database: this.database.database,
        ssl: this.database.ssl,
      },
      ai: {
        defaultProvider: this.ai.defaultProvider,
        defaultModel: this.ai.defaultModel,
        hasOpenRouterKey: Boolean(this.ai.openrouterApiKey),
        hasOpenAIKey: Boolean(this.ai.openaiApiKey),
        hasAnthropicKey: Boolean(this.ai.anthropicApiKey),
      },
      storage: {
        driver: this.storage.driver,
        localDir: this.storage.localDir,
        s3Bucket: this.storage.s3Bucket,
      },
      email: {
        host: this.email.host,
        port: this.email.port,
        from: this.email.from,
      },
      payment: {
        hasStripeKey: Boolean(this.payment.stripeSecretKey),
      },
      monitoring: this.monitoring,
      server: this.server,
    });
  }
}
