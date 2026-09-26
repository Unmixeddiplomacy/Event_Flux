import { Router } from "express";
import { db } from "../db/db.js";
import { commentary, matches } from "../db/schema.js";
import { matchIdParamSchema } from "../validation/matches.js";
import { createCommentarySchema, listCommentaryQuerySchema } from "../validation/commentary.js";
import { eq, desc } from "drizzle-orm";

export const commentaryRouter = Router({ mergeParams: true });

const maxLimit = 100;

commentaryRouter.get('/', async (req, res) => {
    const paramParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
        res.status(400).json({ error: 'Invalid match id', details: paramParsed.error.issues });
        return;
    }

    const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
        res.status(400).json({ error: 'Invalid query', details: queryParsed.error.issues });
        return;
    }

    const { id: matchId } = paramParsed.data;
    const limit = Math.min(queryParsed.data.limit ?? maxLimit, maxLimit);

    try {
        const data = await db
            .select()
            .from(commentary)
            .where(eq(commentary.matchId, matchId))
            .orderBy(desc(commentary.createdAt))
            .limit(limit);

        res.status(200).json({ data });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch commentary', details: JSON.stringify(e) });
    }
});

commentaryRouter.post('/', async (req, res) => {
    const paramParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
        res.status(400).json({ error: 'Invalid match id', details: paramParsed.error.issues });
        return;
    }

    const bodyParsed = createCommentarySchema.safeParse(req.body);
    if (!bodyParsed.success) {
        res.status(400).json({ error: 'Invalid payload', details: bodyParsed.error.issues });
        return;
    }

    const { id: matchId } = paramParsed.data;

    try {
        const [targetMatch] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
        if (!targetMatch) {
            res.status(404).json({ error: 'Match not found' });
            return;
        }

        // Guard 1: Prevent posting commentary to finished matches
        if (targetMatch.status === 'finished') {
            res.status(400).json({ error: 'Cannot post commentary: match is finished and locked' });
            return;
        }
        const [entry] = await db
            .insert(commentary)
            .values({
                ...bodyParsed.data,
                matchId,
            })
            .returning();

        if (res.app.locals.broadcastCommentary) {
            res.app.locals.broadcastCommentary(entry.matchId, entry);
        }

        res.status(201).json({ data: entry });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create commentary', details: JSON.stringify(e) });
    }
});
