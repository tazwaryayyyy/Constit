// lib/logger.ts
// Structured JSON logger for all server-side code.
// Replaces console.error/warn/log throughout the API layer.
// Output is JSON: parseable by Datadog, Logtail, Axiom, Vercel Log Drains, etc.
//
// Usage:
//   import { logger } from "@/lib/logger";
//   logger.error({ err, campaignId }, "Failed to send SMS batch");
//   logger.warn({ userId, used, limit }, "Plan limit exceeded");

import pino from "pino";

export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    // Attach env to every log line so you can filter prod vs. dev in your log tool.
    base: { env: process.env.NODE_ENV },
    formatters: {
        // Normalize level to a string label (pino default is an integer).
        level: (label) => ({ level: label }),
    },
    // Timestamp in ISO 8601 — human-readable in log explorers.
    timestamp: pino.stdTimeFunctions.isoTime,
});
