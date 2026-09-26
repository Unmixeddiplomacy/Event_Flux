import { Router } from 'express';
import {
    createMatchSchema,
    listMatchesQuerySchema,
    matchIdParamSchema,
    updateScoreSchema,
    MATCH_STATUS,
} from '../validation/matches.js';
import { matches, commentary } from '../db/schema.js';
import { db } from '../db/db.js';
import { getMatchStatus } from '../utils/match-status.js';
import { desc, eq } from 'drizzle-orm';

export const matchRouter = Router();
const maxLimit = 100;
matchRouter.get("/", async (req, res) => {
    const parsed = listMatchesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
        return;
    }
    const limit = Math.min(parsed.data.limit ?? 50, maxLimit);
    try {
        const rawData = await db
            .select()
            .from(matches)
            .orderBy(desc(matches.createdAt))
            .limit(limit);

        const data = rawData.map((match) => {
            const currentStatus = getMatchStatus(match.startTime, match.endTime);
            if (currentStatus && currentStatus !== match.status) {
                // Asynchronously update in DB so it persists
                db.update(matches)
                    .set({ status: currentStatus })
                    .where(eq(matches.id, match.id))
                    .catch((err) => console.error(`Failed to update match ${match.id} status:`, err));
                return { ...match, status: currentStatus };
            }
            return match;
        });

        res.status(200).json({ data });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch matches', details: JSON.stringify(e) });
    }
});

matchRouter.post("/", async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
        return;
    }

    const { startTime, endTime, homeScore, awayScore } = parsed.data;

    try {
        const [event] = await db.insert(matches).values({
            ...parsed.data,
            startTime: startTime ? new Date(startTime) : null,
            endTime: endTime ? new Date(endTime) : null,
            homeScore: homeScore ?? 0,
            awayScore: awayScore ?? 0,
            // Fall back to SCHEDULED when startTime/endTime are absent or invalid
            status: getMatchStatus(startTime, endTime) ?? MATCH_STATUS.SCHEDULED,
        }).returning();

        if (res.app.locals.broadcastMatchCreated) {
            res.app.locals.broadcastMatchCreated(event);
        }

        res.status(201).json({ data: event });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create a match', details: JSON.stringify(e) });
    }
});

matchRouter.patch("/:id/score", async (req, res) => {
    const paramParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
        res.status(400).json({ error: 'Invalid match id', details: paramParsed.error.issues });
        return;
    }

    const bodyParsed = updateScoreSchema.safeParse(req.body);
    if (!bodyParsed.success) {
        res.status(400).json({ error: 'Invalid payload', details: bodyParsed.error.issues });
        return;
    }

    const { id } = paramParsed.data;
    const { homeScore, awayScore } = bodyParsed.data;

    try {
        const [existing] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
        if (!existing) {
            res.status(404).json({ error: 'Match not found' });
            return;
        }

        // Guard 1: Prevent changing scores on finished matches
        if (existing.status === 'finished') {
            res.status(400).json({ error: 'Cannot update score: match is finished and locked' });
            return;
        }

        const [updated] = await db
            .update(matches)
            .set({ homeScore, awayScore })
            .where(eq(matches.id, id))
            .returning();

        if (res.app.locals.broadcastScoreUpdate) {
            res.app.locals.broadcastScoreUpdate(id, { homeScore, awayScore, status: updated.status });
        }

        res.status(200).json({ data: updated });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update score', details: JSON.stringify(e) });
    }
});

matchRouter.patch("/:id/finish", async (req, res) => {
    const paramParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
        res.status(400).json({ error: 'Invalid match id', details: paramParsed.error.issues });
        return;
    }
    const { id } = paramParsed.data;

    try {
        const [existing] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
        if (!existing) {
            res.status(404).json({ error: 'Match not found' });
            return;
        }

        if (existing.status === 'finished') {
            res.status(200).json({ data: existing, message: 'Match is already finished' });
            return;
        }

        const [updated] = await db
            .update(matches)
            .set({
                status: 'finished',
                endTime: new Date(),
            })
            .where(eq(matches.id, id))
            .returning();

        // Broadcast score update with finished status to trigger UI lock
        if (res.app.locals.broadcastScoreUpdate) {
            res.app.locals.broadcastScoreUpdate(id, {
                homeScore: updated.homeScore,
                awayScore: updated.awayScore,
                status: 'finished',
            });
        }

        // Broadcast automatic final whistle commentary
        if (res.app.locals.broadcastCommentary) {
            const [whistleComment] = await db
                .insert(commentary)
                .values({
                    matchId: id,
                    message: `FINAL WHISTLE! The match between ${updated.homeTeam} and ${updated.awayTeam} has ended! Final score: ${updated.homeScore} - ${updated.awayScore}.`,
                    eventType: 'whistle',
                    tags: ['fulltime', 'finished'],
                })
                .returning();

            res.app.locals.broadcastCommentary(id, whistleComment);
        }

        res.status(200).json({ data: updated });
    } catch (e) {
        res.status(500).json({ error: 'Failed to finish match', details: JSON.stringify(e) });
    }
});
