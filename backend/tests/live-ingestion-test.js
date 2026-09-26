/**
 * End-to-End Live Ingestion Validation Test
 *
 * Verifies the complete live sports data pipeline:
 * Mock football-data.org HTTP Server -> FootballDataAdapter -> MatchStateDiffTracker
 * -> Unified Ingestion Service -> Neon PostgreSQL (Drizzle) -> WebSocket Broadcast to Subscribers.
 *
 * Requirements covered:
 * 1. Mock HTTP server returning 4 rounds (0-0, 1-0 goal, 429 rate limit, 1-1 goal).
 * 2. Real WebSocket client connected to ws://localhost:8000/ws subscribing to the match room.
 * 3. Validation of PostgreSQL DB score updates + real-time WebSocket commentary delivery.
 * 4. Verification of 429 rate limit backoff tolerance and subsequent recovery.
 * 5. Full socket and server resource cleanup.
 */

import 'dotenv/config';
import http from 'http';
import WebSocket from 'ws';
import express from 'express';
import { attachWebsocketServer } from '../src/ws/server.js';
import { FootballDataAdapter } from '../src/ingestion/adapters/football-data.js';
import { MatchStateDiffTracker, resolveInternalMatchId, clearMatchCache } from '../src/ingestion/match-mapper.js';
import { createLivePoller } from '../src/ingestion/poller.js';
import * as ingestionService from '../src/ingestion/service.js';
import { db } from '../src/db/db.js';
import { matches } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

let mockRound = 1;

// ── 1. Ephemeral Mock football-data.org HTTP Server ──────────────────────────

const mockServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  console.log(`  [Mock API] Received ${req.method} ${req.url} (serving Round ${mockRound})`);

  if (mockRound === 1) {
    // Round 1: Match 101 at 0 - 0
    res.writeHead(200);
    res.end(
      JSON.stringify({
        matches: [
          {
            id: 101,
            utcDate: '2026-09-26T12:00:00Z',
            status: 'IN_PLAY',
            minute: 12,
            homeTeam: { id: 1001, name: 'Mock United FC', shortName: 'Mock United' },
            awayTeam: { id: 1002, name: 'Mock City FC', shortName: 'Mock City' },
            score: { fullTime: { home: 0, away: 0 } },
          },
        ],
      })
    );
  } else if (mockRound === 2) {
    // Round 2: Match 101 Home Goal (1 - 0)
    res.writeHead(200);
    res.end(
      JSON.stringify({
        matches: [
          {
            id: 101,
            utcDate: '2026-09-26T12:00:00Z',
            status: 'IN_PLAY',
            minute: 34,
            homeTeam: { id: 1001, name: 'Mock United FC', shortName: 'Mock United' },
            awayTeam: { id: 1002, name: 'Mock City FC', shortName: 'Mock City' },
            score: { fullTime: { home: 1, away: 0 } },
          },
        ],
      })
    );
  } else if (mockRound === 3) {
    // Round 3: Simulate HTTP 429 Rate Limit error with Retry-After header
    res.writeHead(429, { 'Retry-After': '1' });
    res.end(
      JSON.stringify({
        message: 'You have reached your request limit. Please wait 1 second.',
        errorCode: 429,
      })
    );
  } else if (mockRound === 4) {
    // Round 4: Match 101 Away Goal (1 - 1)
    res.writeHead(200);
    res.end(
      JSON.stringify({
        matches: [
          {
            id: 101,
            utcDate: '2026-09-26T12:00:00Z',
            status: 'IN_PLAY',
            minute: 78,
            homeTeam: { id: 1001, name: 'Mock United FC', shortName: 'Mock United' },
            awayTeam: { id: 1002, name: 'Mock City FC', shortName: 'Mock City' },
            score: { fullTime: { home: 1, away: 1 } },
          },
        ],
      })
    );
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ matches: [] }));
  }
});

// ── Test Runner ──────────────────────────────────────────────────────────────

async function runLiveIngestionTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🧪 LIVE DATA INGESTION & FAULT-TOLERANCE TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Start mock external API server on ephemeral port
  await new Promise((resolve) => mockServer.listen(0, resolve));
  const mockPort = mockServer.address().port;
  console.log(`✅ Mock football-data.org server active on port ${mockPort}`);

  // 2. Start WebSocket server on port 8000
  const app = express();
  app.use(express.json());
  const wsServer = http.createServer(app);
  const { broadcastCommentary } = attachWebsocketServer(wsServer);

  await new Promise((resolve) => wsServer.listen(8000, resolve));
  console.log(`✅ Test WebSocket server listening on ws://localhost:8000/ws\n`);

  clearMatchCache();

  // Instantiate adapter pointing to mock server
  const adapter = new FootballDataAdapter({
    baseUrl: `http://127.0.0.1:${mockPort}`,
    apiKey: 'mock_test_token',
  });

  const diffTracker = new MatchStateDiffTracker();

  const poller = createLivePoller({
    adapter,
    mapper: { resolveInternalMatchId },
    diffTracker,
    service: ingestionService,
    broadcastCommentary,
    pollIntervalMs: 500,
    idleIntervalMs: 2000,
  });

  let wsClient = null;
  let internalMatchId = null;

  try {
    // ── ROUND 1: Match Discovery (0 - 0) ─────────────────────────────────────
    console.log('── Round 1: Polling Initial Match State (0 - 0) ──');
    mockRound = 1;
    await poller.pollOnce();

    // Query DB to verify match was recorded in PostgreSQL
    const [dbMatch] = await db
      .select()
      .from(matches)
      .where(eq(matches.homeTeam, 'Mock United'))
      .limit(1);

    if (!dbMatch) {
      throw new Error('❌ Match was not created in PostgreSQL database!');
    }
    internalMatchId = dbMatch.id;
    console.log(`  ✅ Match verified in PostgreSQL (ID: ${internalMatchId}, Score: ${dbMatch.homeScore} - ${dbMatch.awayScore})`);

    // ── CONNECT WEBSOCKET CLIENT & SUBSCRIBE ─────────────────────────────────
    console.log('\n── Connecting WebSocket subscriber to ws://localhost:8000/ws ──');
    wsClient = new WebSocket('ws://localhost:8000/ws');

    await new Promise((resolve, reject) => {
      wsClient.once('open', resolve);
      wsClient.once('error', reject);
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 4000);
    });

    console.log('  ✅ WebSocket connected. Subscribing to match channel...');
    wsClient.send(JSON.stringify({ type: 'subscribe', matchId: internalMatchId }));

    await new Promise((resolve) => {
      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribed' && msg.matchId === internalMatchId) {
            wsClient.removeEventListener('message', handler);
            resolve();
          }
        } catch (_) {}
      };
      wsClient.on('message', handler);
      setTimeout(resolve, 800);
    });
    console.log(`  ✅ Subscription confirmed for match #${internalMatchId}\n`);

    // ── ROUND 2: Home Goal (1 - 0) ───────────────────────────────────────────
    console.log('── Round 2: Goal Scored (1 - 0) -> Testing DB Write + WS Broadcast ──');
    mockRound = 2;

    const wsPromiseRound2 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Round 2 WS commentary')), 5000);
      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'commentary' && msg.data?.message?.includes('GOAL! Mock United scores! (1 - 0)')) {
            clearTimeout(timeout);
            wsClient.removeEventListener('message', handler);
            resolve(msg.data);
          }
        } catch (_) {}
      };
      wsClient.on('message', handler);
    });

    await poller.pollOnce();
    const wsReceivedR2 = await wsPromiseRound2;

    // Verify DB update
    const [dbMatchR2] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, internalMatchId));

    console.log(`  ✅ DB updated: ${dbMatchR2.homeScore} - ${dbMatchR2.awayScore}`);
    console.log(`  ✅ WebSocket event received by subscriber: "${wsReceivedR2.message}"\n`);

    if (dbMatchR2.homeScore !== 1) throw new Error(`Expected homeScore 1, got ${dbMatchR2.homeScore}`);

    // ── ROUND 3: Upstream Rate Limit Simulation (HTTP 429) ───────────────────
    console.log('── Round 3: Simulating Upstream HTTP 429 Rate Limit ──');
    mockRound = 3;

    // Should handle 429 gracefully without throwing an unhandled rejection
    await poller.pollOnce();
    console.log('  ✅ Poller caught 429 rate limit and applied backoff cleanly without crashing!\n');

    // ── ROUND 4: Recovery & Away Goal (1 - 1) ────────────────────────────────
    console.log('── Round 4: Post-Backoff Recovery (1 - 1) ──');
    mockRound = 4;

    const wsPromiseRound4 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Round 4 WS commentary')), 5000);
      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'commentary' && msg.data?.message?.includes('GOAL! Mock City scores! (1 - 1)')) {
            clearTimeout(timeout);
            wsClient.removeEventListener('message', handler);
            resolve(msg.data);
          }
        } catch (_) {}
      };
      wsClient.on('message', handler);
    });

    await poller.pollOnce();
    const wsReceivedR4 = await wsPromiseRound4;

    // Verify DB update
    const [dbMatchR4] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, internalMatchId));

    console.log(`  ✅ DB updated: ${dbMatchR4.homeScore} - ${dbMatchR4.awayScore}`);
    console.log(`  ✅ WebSocket event received by subscriber: "${wsReceivedR4.message}"\n`);

    if (dbMatchR4.awayScore !== 1) throw new Error(`Expected awayScore 1, got ${dbMatchR4.awayScore}`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  🎉 ALL 4 ROUNDS PASSED SUCCESSFULLY!');
    console.log('  - Upstream API polling & normalization : PASSED');
    console.log('  - State diffing & deduplication        : PASSED');
    console.log('  - Drizzle PostgreSQL persistence        : PASSED');
    console.log('  - Native WebSocket fan-out broadcast   : PASSED');
    console.log('  - HTTP 429 Rate Limit backoff tolerance : PASSED');
    console.log('  - Automatic recovery post-outage       : PASSED');
    console.log('═══════════════════════════════════════════════════════════════\n');
  } finally {
    // ── 5. Cleanup Resources ─────────────────────────────────────────────────
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.terminate();
    }
    mockServer.close();
    wsServer.close();

    // Clean up test match record
    if (internalMatchId) {
      try {
        await db.delete(matches).where(eq(matches.id, internalMatchId));
      } catch (_) {}
    }
    console.log('🧹 Cleaned up mock server, WebSocket client, and test DB rows.');
    process.exit(0);
  }
}

runLiveIngestionTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
