import {
  ExternalMatchesResponseSchema,
  NormalizedMatchEventSchema,
  RateLimitError,
  ApiError,
} from '../contracts.js';

/**
 * Maps upstream football-data.org match status to internal PostgreSQL enum:
 * 'scheduled' | 'live' | 'finished'
 */
export function mapExternalStatus(status) {
  const upper = String(status || '').toUpperCase();
  if (['IN_PLAY', 'PAUSED', 'LIVE'].includes(upper)) {
    return 'live';
  }
  if (['FINISHED', 'AWARDED'].includes(upper)) {
    return 'finished';
  }
  return 'scheduled';
}

/**
 * FootballDataAdapter
 * Polls football-data.org v4 endpoints, parses payloads via Zod,
 * handles 429 rate-limiting with Retry-After detection, and normalizes
 * external match structures into Event_Flux internal domain contracts.
 */
export class FootballDataAdapter {
  constructor({
    apiKey = process.env.FOOTBALL_DATA_API_KEY,
    baseUrl = 'https://api.football-data.org/v4',
  } = {}) {
    this.apiKey = (apiKey || '').trim();
    this.baseUrl = (baseUrl || 'https://api.football-data.org/v4').replace(/\/+$/, '');
  }

  /**
   * Internal HTTP execution with error boundary and Zod contract enforcement.
   */
  async _fetchFromEndpoint(url) {
    const headers = {};
    if (this.apiKey) {
      headers['X-Auth-Token'] = this.apiKey;
    }

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (netErr) {
      throw new ApiError(
        `Network failure while contacting sports API: ${netErr.message}`,
        0,
        netErr
      );
    }

    if (res.status === 429) {
      const retryHeader =
        res.headers.get('retry-after') ||
        res.headers.get('x-requestcounter-reset');
      const retryAfter = retryHeader ? parseInt(retryHeader, 10) : 60;
      throw new RateLimitError(
        `football-data.org rate limit reached (HTTP 429). Retry after ${retryAfter}s`,
        retryAfter
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new ApiError(
        `football-data.org error (HTTP ${res.status}): ${errText}`,
        res.status,
        errText
      );
    }

    let json;
    try {
      json = await res.json();
    } catch (jsonErr) {
      throw new ApiError(`Invalid JSON from sports API: ${jsonErr.message}`, 502);
    }

    const parsed = ExternalMatchesResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        'Upstream schema validation failed against ExternalMatchesResponseSchema',
        422,
        parsed.error.issues
      );
    }

    return parsed.data.matches.map((match) => this.normalizeMatch(match));
  }

  /**
   * Fetches active in-play matches.
   * @param {Object} [options]
   * @param {string} [options.statuses='IN_PLAY,PAUSED'] - Comma-separated external statuses
   * @returns {Promise<Array<import('../contracts.js').NormalizedMatchEvent>>}
   */
  async fetchLiveMatches({ statuses = 'IN_PLAY,PAUSED' } = {}) {
    return this._fetchFromEndpoint(`${this.baseUrl}/matches?status=${statuses}`);
  }

  /**
   * Fetches upcoming scheduled fixtures within a date window (up to 10 days).
   * @param {Object} [options]
   * @param {number} [options.daysAhead=10]
   * @returns {Promise<Array<import('../contracts.js').NormalizedMatchEvent>>}
   */
  async fetchUpcomingMatches({ daysAhead = 10 } = {}) {
    const dFrom = new Date().toISOString().split('T')[0];
    const dTo = new Date(Date.now() + Math.min(daysAhead, 10) * 86400000)
      .toISOString()
      .split('T')[0];
    return this._fetchFromEndpoint(
      `${this.baseUrl}/matches?dateFrom=${dFrom}&dateTo=${dTo}`
    );
  }

  /**
   * Fetches live matches first. If no matches are actively in-play,
   * falls back to fetching upcoming scheduled fixtures so the dashboard stays populated.
   * @returns {Promise<Array<import('../contracts.js').NormalizedMatchEvent>>}
   */
  async fetchAllMatches({ daysAhead = 10 } = {}) {
    try {
      const live = await this.fetchLiveMatches();
      if (live && live.length > 0) return live;
    } catch (_) {}

    // Fall back to upcoming fixtures when off-hours
    return this.fetchUpcomingMatches({ daysAhead });
  }

  /**
   * Normalizes an external football-data.org match object to Event_Flux internal shape.
   */
  normalizeMatch(match) {
    const homeTeam = match.homeTeam.shortName || match.homeTeam.name;
    const awayTeam = match.awayTeam.shortName || match.awayTeam.name;
    const homeScore = match.score?.fullTime?.home ?? 0;
    const awayScore = match.score?.fullTime?.away ?? 0;
    const status = mapExternalStatus(match.status);

    return NormalizedMatchEventSchema.parse({
      externalId: String(match.id),
      sport: 'football',
      homeTeam,
      awayTeam,
      homeScore: Number(homeScore) || 0,
      awayScore: Number(awayScore) || 0,
      status,
      rawStatus: match.status,
      minute: match.minute ?? null,
      startTime: match.utcDate ?? null,
      events: [],
    });
  }
}
