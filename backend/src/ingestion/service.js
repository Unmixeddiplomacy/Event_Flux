import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { matches, commentary } from '../db/schema.js';

/**
 * Unified Ingestion Service
 * Handles persistence to PostgreSQL via Drizzle ORM and dispatches
 * real-time broadcast events, completely decoupled from Express req/res.
 *
 * @param {Object} params
 * @param {number} params.matchId - Target PostgreSQL matches.id
 * @param {number} [params.homeScore] - Updated home team score
 * @param {number} [params.awayScore] - Updated away team score
 * @param {'scheduled' | 'live' | 'finished'} [params.status] - Updated match status
 * @param {Object} [params.commentaryEvent] - Optional commentary item to insert
 * @param {Function} [params.broadcastFn] - Fallback broadcast callback
 * @param {Function} [params.broadcastCommentary] - WebSocket commentary broadcaster (matchId, entry)
 * @param {Function} [params.broadcastScoreUpdate] - WebSocket score broadcaster (matchId, scoreData)
 * @returns {Promise<{ match: Object|null, commentary: Object|null }>}
 */
export async function ingestMatchUpdate({
  matchId,
  homeScore,
  awayScore,
  status,
  commentaryEvent,
  broadcastFn,
  broadcastCommentary,
  broadcastScoreUpdate,
}) {
  if (!matchId || typeof matchId !== 'number') {
    const error = new Error(`[ingestion/service] Invalid or missing matchId: ${matchId}`);
    error.matchId = matchId;
    error.op = 'ingestMatchUpdate';
    throw error;
  }

  let updatedMatch = null;
  let savedCommentary = null;

  try {
    // 1. Update match row if any score or status attributes are present
    const hasMatchUpdates =
      homeScore !== undefined ||
      awayScore !== undefined ||
      status !== undefined;

    if (hasMatchUpdates) {
      const updateValues = {};
      if (homeScore !== undefined) updateValues.homeScore = homeScore;
      if (awayScore !== undefined) updateValues.awayScore = awayScore;
      if (status !== undefined) updateValues.status = status;

      const [updated] = await db
        .update(matches)
        .set(updateValues)
        .where(eq(matches.id, matchId))
        .returning();

      updatedMatch = updated || null;

      if (updatedMatch) {
        if (typeof broadcastScoreUpdate === 'function') {
          broadcastScoreUpdate(matchId, {
            type: 'score_update',
            matchId,
            homeScore: updatedMatch.homeScore,
            awayScore: updatedMatch.awayScore,
            status: updatedMatch.status,
          });
        } else if (typeof broadcastFn === 'function') {
          broadcastFn(matchId, {
            type: 'score_update',
            data: updatedMatch,
          });
        }
      }
    }

    // 2. Insert commentary entry if commentaryEvent provided
    if (commentaryEvent && commentaryEvent.message) {
      const [entry] = await db
        .insert(commentary)
        .values({
          matchId,
          minute: commentaryEvent.minute ?? null,
          sequence: commentaryEvent.sequence ?? null,
          period: commentaryEvent.period ?? null,
          eventType: commentaryEvent.eventType ?? null,
          actor: commentaryEvent.actor ?? null,
          team: commentaryEvent.team ?? null,
          message: commentaryEvent.message,
          metadata: commentaryEvent.metadata ?? null,
          tags: commentaryEvent.tags ?? null,
        })
        .returning();

      savedCommentary = entry;

      const cb = broadcastCommentary || broadcastFn;
      if (typeof cb === 'function') {
        cb(matchId, savedCommentary);
      }
    }

    return {
      match: updatedMatch,
      commentary: savedCommentary,
    };
  } catch (error) {
    const structuredError = new Error(
      `[ingestion/service] Failed match update for matchId=${matchId}: ${error.message}`
    );
    structuredError.matchId = matchId;
    structuredError.op = 'ingestMatchUpdate';
    structuredError.originalError = error;
    throw structuredError;
  }
}
