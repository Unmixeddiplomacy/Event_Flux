import { Router } from 'express';
import { createMatchSchema, listMatchesQuerySchema, MATCH_STATUS } from '../validation/matches.js';
import { matches } from '../db/schema.js';
import { db } from '../db/db.js';
import { getMatchStatus } from '../utils/match-status.js';
import { desc } from 'drizzle-orm';

export const matchRouter = Router();
const maxLimit = 100;
matchRouter.get("/", async (req, res) => {
    const parsed = listMatchesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', details: JSON.stringify(parsed.error) });
        return;
    }
    const limit = Math.min(parsed.data.limit ?? 50, maxLimit);
    try {
        const data = await db
            .select()
            .from(matches)
            .orderBy(desc(matches.createdAt))
            .limit(limit);
        res.status(200).json({ data });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch matches', details: JSON.stringify(e) })
    }

});

matchRouter.post("/", async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
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

        res.status(201).json({ data: event });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create a match', details: JSON.stringify(e) });
    }
});
