import { z } from 'zod';

// ── Custom Error Classes ─────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded', retryAfterSeconds = 60) {
    super(message);
    this.name = 'RateLimitError';
    this.status = 429;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApiError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

// ── football-data.org v4 Schemas ─────────────────────────────────────────────

export const ExternalScoreDetailSchema = z.object({
  home: z.number().nullable().optional(),
  away: z.number().nullable().optional(),
});

export const ExternalScoreSchema = z.object({
  winner: z.string().nullable().optional(),
  duration: z.string().optional(),
  fullTime: ExternalScoreDetailSchema.default({ home: 0, away: 0 }),
  halfTime: ExternalScoreDetailSchema.optional(),
  regularTime: ExternalScoreDetailSchema.optional(),
  extraTime: ExternalScoreDetailSchema.optional(),
  penalties: ExternalScoreDetailSchema.optional(),
});

export const ExternalTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  shortName: z.string().optional(),
  tla: z.string().optional(),
  crest: z.string().optional(),
});

export const ExternalMatchSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  utcDate: z.string(),
  status: z.string(),
  minute: z.number().nullable().optional(),
  homeTeam: ExternalTeamSchema,
  awayTeam: ExternalTeamSchema,
  score: ExternalScoreSchema.default({ fullTime: { home: 0, away: 0 } }),
  goals: z.array(z.any()).optional(),
});

export const ExternalMatchesResponseSchema = z.object({
  matches: z.array(ExternalMatchSchema).default([]),
});

// ── Event_Flux Normalized Internal Contracts ────────────────────────────────

export const NormalizedCommentaryItemSchema = z.object({
  minute: z.number().nullable().optional(),
  period: z.string().nullable().optional(),
  eventType: z.string().nullable().optional(),
  actor: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export const NormalizedMatchEventSchema = z.object({
  externalId: z.string(),
  sport: z.string().default('football'),
  homeTeam: z.string(),
  awayTeam: z.string(),
  homeScore: z.number().int().nonnegative().default(0),
  awayScore: z.number().int().nonnegative().default(0),
  status: z.enum(['scheduled', 'live', 'finished']),
  rawStatus: z.string(),
  minute: z.number().nullable().optional(),
  startTime: z.string().nullable().optional(),
  events: z.array(NormalizedCommentaryItemSchema).default([]),
});
