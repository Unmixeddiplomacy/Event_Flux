import { RateLimitError } from './contracts.js';

/**
 * Creates a resilient live polling supervisor.
 *
 * Employs recursive scheduling (preventing overlapping runs), adaptive idle
 * intervals (reducing server & API load when no matches are active), exponential
 * backoff on HTTP 429/5xx, and safe error boundary wrapping.
 *
 * @param {Object} options
 * @param {Object} options.adapter - Upstream API adapter (e.g., FootballDataAdapter)
 * @param {Object} options.mapper - Match resolver (e.g., resolveInternalMatchId)
 * @param {Object} options.diffTracker - In-memory state diff tracker (MatchStateDiffTracker)
 * @param {Object} options.service - Ingestion service (ingestMatchUpdate)
 * @param {Function} [options.broadcastCommentary] - WebSocket broadcast callback
 * @param {number} [options.pollIntervalMs=15000] - Polling interval during active matches (15s)
 * @param {number} [options.idleIntervalMs=60000] - Polling interval when no matches are live (60s)
 * @param {number} [options.maxBackoffMs=120000] - Maximum backoff duration on errors (120s)
 * @returns {{ start: Function, stop: Function, isRunning: Function, pollOnce: Function }}
 */
export function createLivePoller({
  adapter,
  mapper,
  diffTracker,
  service,
  broadcastCommentary,
  pollIntervalMs = 15000,
  idleIntervalMs = 60000,
  maxBackoffMs = 120000,
}) {
  const effectivePollInterval = Number(pollIntervalMs) || 15000;
  const effectiveIdleInterval = Number(idleIntervalMs) || 60000;
  const effectiveMaxBackoff = Number(maxBackoffMs) || 120000;

  let timerId = null;
  let isStopped = true;
  let isExecuting = false;
  let currentBackoffMs = effectivePollInterval;

  /**
   * Recursive scheduler: sets a one-shot timeout for the next execution.
   * Guarantees zero overlapping runs even during slow database or network responses.
   */
  function scheduleNext(delayMs) {
    if (isStopped) return;
    clearTimeout(timerId);

    // Apply ±5% jitter to prevent thundering herd
    const jitter = Math.floor((Math.random() - 0.5) * (delayMs * 0.1));
    const finalDelay = Math.max(500, delayMs + jitter);

    timerId = setTimeout(async () => {
      await pollCycle();
    }, finalDelay);
  }

  /**
   * Main polling cycle
   */
  async function pollCycle() {
    if (isStopped || isExecuting) return;
    isExecuting = true;

    let nextDelay = effectivePollInterval;

    try {
      // 1. Fetch matches from upstream adapter (fetches live, or upcoming fixtures if off-hours)
      const fetchFn = typeof adapter.fetchAllMatches === 'function'
        ? adapter.fetchAllMatches.bind(adapter)
        : adapter.fetchLiveMatches.bind(adapter);
      const liveMatches = (await fetchFn()) || [];

      // Reset backoff on successful upstream response
      currentBackoffMs = effectivePollInterval;

      // 2. Adaptive interval: if no live matches are currently in-play,
      // relax polling frequency to idle interval (60s) to conserve API quotas and DB load
      const hasActivePlay = liveMatches.some((m) => m.status === 'live');
      if (!hasActivePlay) {
        nextDelay = effectiveIdleInterval;
      } else {
        nextDelay = effectivePollInterval;
      }

      // Process each live match sequentially to protect the DB connection pool
      for (const match of liveMatches) {
        try {
          // Resolve internal PostgreSQL match ID
          const internalId = await mapper.resolveInternalMatchId(match);

          // Compute delta against last-seen state
          const deltas = diffTracker.detectDeltas(internalId, match);

          if (deltas.hasChanges) {
            // Update score and status if changed
            if (deltas.scoreUpdated || deltas.statusUpdated) {
              await service.ingestMatchUpdate({
                matchId: internalId,
                homeScore: match.homeScore,
                awayScore: match.awayScore,
                status: match.status,
                broadcastFn: broadcastCommentary,
              });
            }

            // Insert and broadcast each generated commentary event
            for (const commentaryItem of deltas.commentaryToInsert) {
              await service.ingestMatchUpdate({
                matchId: internalId,
                commentaryEvent: commentaryItem,
                broadcastCommentary,
              });
            }
          }
        } catch (matchErr) {
          console.error(
            `[LivePoller] Failed processing match ${match.externalId} (${match.homeTeam} vs ${match.awayTeam}):`,
            matchErr.message
          );
        }
      }
    } catch (err) {
      if (err instanceof RateLimitError || err.status === 429) {
        // Exponential backoff up to maxBackoffMs
        const retryAfterMs = (err.retryAfterSeconds || 60) * 1000;
        currentBackoffMs = Math.min(
          effectiveMaxBackoff,
          Math.max(currentBackoffMs * 2, retryAfterMs)
        );
        nextDelay = currentBackoffMs;
        console.warn(
          `[LivePoller] Rate limited by upstream API (HTTP 429). Backing off for ${Math.round(nextDelay / 1000)}s`
        );
      } else {
        // Upstream network / 5xx error: apply standard 30s backoff
        currentBackoffMs = Math.min(
          effectiveMaxBackoff,
          Math.max(30000, currentBackoffMs * 1.5)
        );
        nextDelay = currentBackoffMs;
        console.error(
          `[LivePoller] Upstream poll failed (${err.name || 'Error'}): ${err.message}. Retrying in ${Math.round(nextDelay / 1000)}s`
        );
      }
    } finally {
      isExecuting = false;
      if (!isStopped) {
        scheduleNext(nextDelay);
      }
    }
  }

  return {
    start() {
      if (!isStopped) return;
      isStopped = false;
      currentBackoffMs = effectivePollInterval;
      console.log(
        `[LivePoller] Initialized: active interval = ${effectivePollInterval / 1000}s, idle interval = ${effectiveIdleInterval / 1000}s`
      );
      // Run first poll immediately
      scheduleNext(0);
    },

    stop() {
      if (isStopped) return;
      isStopped = true;
      clearTimeout(timerId);
      timerId = null;
      console.log('[LivePoller] Stopped cleanly.');
    },

    isRunning() {
      return !isStopped;
    },

    async pollOnce() {
      const prevStopped = isStopped;
      isStopped = false;
      await pollCycle();
      isStopped = prevStopped;
    },
  };
}
