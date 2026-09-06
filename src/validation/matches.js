import { z } from 'zod';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MATCH_STATUS = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  FINISHED: 'finished',
};

// ── Helper ────────────────────────────────────────────────────────────────────

/** Returns true if the string is a valid ISO 8601 date. */
const isISODate = (val) => !isNaN(Date.parse(val));

// ── Schemas ───────────────────────────────────────────────────────────────────

/**
 * GET /matches?limit=<n>
 * limit — optional, coerced positive integer, max 100.
 */
export const listMatchesQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? Number(val) : undefined))
    .pipe(
      z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
    ),
});

/**
 * Route param: /matches/:id
 * id — required, coerced positive integer.
 */
export const matchIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * POST /matches — create a new match.
 * - sport, homeTeam, awayTeam: required non-empty strings.
 * - startTime, endTime: optional valid ISO date strings.
 * - endTime must be chronologically after startTime (when both are provided).
 * - homeScore, awayScore: optional coerced non-negative integers.
 */
export const createMatchSchema = z
  .object({
    sport: z.string().trim().min(1, 'sport is required'),
    homeTeam: z.string().trim().min(1, 'homeTeam is required'),
    awayTeam: z.string().trim().min(1, 'awayTeam is required'),
    startTime: z
      .string()
      .refine(isISODate, { message: 'startTime must be a valid ISO date string' })
      .optional(),
    endTime: z
      .string()
      .refine(isISODate, { message: 'endTime must be a valid ISO date string' })
      .optional(),
    homeScore: z.coerce.number().int().nonnegative().optional(),
    awayScore: z.coerce.number().int().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startTime && data.endTime) {
      if (new Date(data.endTime) <= new Date(data.startTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'endTime must be chronologically after startTime',
        });
      }
    }
  });

/**
 * PATCH /matches/:id/score — update live score.
 * homeScore and awayScore: required, coerced non-negative integers.
 */
export const updateScoreSchema = z.object({
  homeScore: z.coerce.number().int().nonnegative(),
  awayScore: z.coerce.number().int().nonnegative(),
});
