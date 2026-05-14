// lib/rateLimit.ts
// Production-grade sliding-window rate limiters backed by Upstash Redis.
// These survive Vercel cold starts — unlike the in-memory map they replace.
//
// Required environment variables (from https://console.upstash.com):
//   UPSTASH_REDIS_REST_URL  — e.g. https://us1-xxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN — your REST token
//
// Both variables are read automatically by Redis.fromEnv().

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// AI generation: 10 calls per 10 seconds per user.
// Prevents Groq API abuse while allowing genuine burst usage.
export const aiRateLimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, "10 s"),
    analytics: true,
    prefix: "constit:ai",
});

// SMS send: 50 sends per minute per user.
// Aligns with Twilio's recommended burst rate for production accounts.
export const smsRateLimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(50, "1 m"),
    analytics: true,
    prefix: "constit:sms",
});
