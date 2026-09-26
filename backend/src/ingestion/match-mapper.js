import { and, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';

// In-memory cache: externalMatchId -> internalMatchId
const externalToInternalMap = new Map();

/**
 * Resolves an external match to an internal PostgreSQL matches.id.
 * Checks the in-memory cache first, then queries PostgreSQL.
 * If not found in DB, creates a new match record and caches the link.
 *
 * @param {import('./contracts.js').NormalizedMatchEvent} normalizedMatch
 * @returns {Promise<number>} Internal matches.id
 */
export async function resolveInternalMatchId(normalizedMatch) {
  const externalId = String(normalizedMatch.externalId);

  // 1. In-memory cache hit
  if (externalToInternalMap.has(externalId)) {
    return externalToInternalMap.get(externalId);
  }

  // 2. Query DB by team names and sport
  const [existing] = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.homeTeam, normalizedMatch.homeTeam),
        eq(matches.awayTeam, normalizedMatch.awayTeam),
        eq(matches.sport, normalizedMatch.sport || 'football')
      )
    )
    .limit(1);

  if (existing) {
    externalToInternalMap.set(externalId, existing.id);
    return existing.id;
  }

  // 3. Match not found: insert into PostgreSQL
  const startTime = normalizedMatch.startTime
    ? new Date(normalizedMatch.startTime)
    : new Date();

  const [created] = await db
    .insert(matches)
    .values({
      sport: normalizedMatch.sport || 'football',
      homeTeam: normalizedMatch.homeTeam,
      awayTeam: normalizedMatch.awayTeam,
      status: normalizedMatch.status || 'live',
      startTime,
      homeScore: normalizedMatch.homeScore ?? 0,
      awayScore: normalizedMatch.awayScore ?? 0,
    })
    .returning();

  externalToInternalMap.set(externalId, created.id);
  return created.id;
}

/**
 * Clears or inspects the external ID mapping cache (useful for testing/resets)
 */
export function clearMatchCache() {
  externalToInternalMap.clear();
}

export function getMappedId(externalId) {
  return externalToInternalMap.get(String(externalId));
}

export function setMappedId(externalId, internalId) {
  externalToInternalMap.set(String(externalId), internalId);
}

/**
 * MatchStateDiffTracker
 * Tracks the last-seen state per internal match in memory.
 * Compares incoming snapshots against previous states to synthesize
 * human-readable commentary events (goals, status changes) and eliminate duplicate broadcasts.
 */
export class MatchStateDiffTracker {
  constructor() {
    /** @type {Map<number, { homeScore: number, awayScore: number, status: string, rawStatus: string, minute: number|null }>} */
    this.states = new Map();
  }

  /**
   * Compares the incoming normalized match snapshot with previously seen state.
   *
   * @param {number} internalMatchId
   * @param {import('./contracts.js').NormalizedMatchEvent} normalizedMatch
   * @returns {{
   *   hasChanges: boolean,
   *   scoreUpdated: boolean,
   *   statusUpdated: boolean,
   *   commentaryToInsert: Array<Object>
   * }}
   */
  detectDeltas(internalMatchId, normalizedMatch) {
    const prev = this.states.get(internalMatchId);
    const current = {
      homeScore: normalizedMatch.homeScore ?? 0,
      awayScore: normalizedMatch.awayScore ?? 0,
      status: normalizedMatch.status,
      rawStatus: normalizedMatch.rawStatus || normalizedMatch.status,
      minute: normalizedMatch.minute ?? null,
    };

    const commentaryToInsert = [];

    // Case 1: First time observing this match
    if (!prev) {
      this.states.set(internalMatchId, current);

      commentaryToInsert.push({
        minute: current.minute,
        period: current.status,
        eventType: 'status',
        team: null,
        actor: null,
        message: `Live commentary connected: ${normalizedMatch.homeTeam} vs ${normalizedMatch.awayTeam} (Score: ${current.homeScore} - ${current.awayScore}).`,
        metadata: {
          externalId: normalizedMatch.externalId,
          source: 'live_api_adapter',
        },
        tags: ['live_start'],
      });

      return {
        hasChanges: true,
        scoreUpdated: false,
        statusUpdated: false,
        commentaryToInsert,
      };
    }

    // Case 2: Subsequent polls — check for differences
    const homeScoreDiff = current.homeScore - prev.homeScore;
    const awayScoreDiff = current.awayScore - prev.awayScore;
    const scoreUpdated = homeScoreDiff !== 0 || awayScoreDiff !== 0;
    const statusUpdated =
      prev.rawStatus !== current.rawStatus || prev.status !== current.status;

    // Detect Goal Events
    if (homeScoreDiff > 0) {
      commentaryToInsert.push({
        minute: current.minute,
        period: current.status,
        eventType: 'goal',
        team: normalizedMatch.homeTeam,
        actor: normalizedMatch.homeTeam,
        message: `GOAL! ${normalizedMatch.homeTeam} scores! (${current.homeScore} - ${current.awayScore})`,
        metadata: {
          delta: homeScoreDiff,
          scoringTeam: 'home',
          homeScore: current.homeScore,
          awayScore: current.awayScore,
        },
        tags: ['goal', 'score_update'],
      });
    }

    if (awayScoreDiff > 0) {
      commentaryToInsert.push({
        minute: current.minute,
        period: current.status,
        eventType: 'goal',
        team: normalizedMatch.awayTeam,
        actor: normalizedMatch.awayTeam,
        message: `GOAL! ${normalizedMatch.awayTeam} scores! (${current.homeScore} - ${current.awayScore})`,
        metadata: {
          delta: awayScoreDiff,
          scoringTeam: 'away',
          homeScore: current.homeScore,
          awayScore: current.awayScore,
        },
        tags: ['goal', 'score_update'],
      });
    }

    // Detect Status / Period Changes
    if (statusUpdated) {
      let statusMessage = `Match status updated: ${current.rawStatus}`;
      const upper = String(current.rawStatus).toUpperCase();

      if (upper === 'PAUSED' || upper === 'HALF_TIME') {
        statusMessage = `Half time: ${normalizedMatch.homeTeam} ${current.homeScore} - ${current.awayScore} ${normalizedMatch.awayTeam}.`;
      } else if (upper === 'IN_PLAY') {
        statusMessage = prev.rawStatus === 'PAUSED'
          ? 'Second half is underway.'
          : 'Match is now in play.';
      } else if (current.status === 'finished') {
        statusMessage = `Full time: Match ended. Final score: ${normalizedMatch.homeTeam} ${current.homeScore} - ${current.awayScore} ${normalizedMatch.awayTeam}.`;
      }

      commentaryToInsert.push({
        minute: current.minute,
        period: current.status,
        eventType: 'status',
        team: null,
        actor: null,
        message: statusMessage,
        metadata: {
          previousStatus: prev.rawStatus,
          newStatus: current.rawStatus,
        },
        tags: ['status_change'],
      });
    }

    // Update state cache
    this.states.set(internalMatchId, current);

    // Evict finished matches from memory to prevent unbounded memory growth
    if (current.status === 'finished') {
      this.states.delete(internalMatchId);
      externalToInternalMap.delete(String(normalizedMatch.externalId));
    }

    const hasChanges =
      scoreUpdated || statusUpdated || commentaryToInsert.length > 0;

    return {
      hasChanges,
      scoreUpdated,
      statusUpdated,
      commentaryToInsert,
    };
  }

  getState(internalMatchId) {
    return this.states.get(internalMatchId);
  }

  clear() {
    this.states.clear();
  }
}
