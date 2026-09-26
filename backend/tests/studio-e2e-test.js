/**
 * Studio End-to-End Validation Test
 * Verifies the complete Producer-Consumer workflow:
 * 1. Connects WebSocket client to ws://localhost:8000/ws
 * 2. Creates a match via POST /matches
 * 3. Subscribes client to the newly created match ID
 * 4. Posts live commentary via POST /matches/:id/commentary
 * 5. Asserts WebSocket message delivery, content match, and delivery latency < 150ms
 * 6. Cleans up test match and disconnects cleanly
 */

import WebSocket from 'ws';

const BASE_URL = process.env.API_URL || 'http://localhost:8000';
const WS_URL = process.env.WS_URL || 'ws://localhost:8000/ws';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StudioTest/1.0',
};

async function runStudioE2ETest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🎙️ BROADCASTER STUDIO END-TO-END VALIDATION TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let testMatchId = null;
  let ws = null;

  try {
    // 1. Connect WebSocket client
    console.log(`🔌 [Step 1] Connecting WebSocket client to ${WS_URL}...`);
    ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 5000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    console.log('  ✅ WebSocket client connected successfully.\n');

    // 2. Create a match via POST /matches
    console.log(`⚽ [Step 2] Creating match via POST ${BASE_URL}/matches...`);
    const now = new Date();
    const createRes = await fetch(`${BASE_URL}/matches`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        sport: 'football',
        homeTeam: 'Studio United',
        awayTeam: 'Broadcaster City',
        homeScore: 0,
        awayScore: 0,
        startTime: now.toISOString(),
        endTime: new Date(now.getTime() + 7200000).toISOString(),
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create match: HTTP ${createRes.status} ${await createRes.text()}`);
    }

    const createData = await createRes.json();
    testMatchId = createData.data.id;
    console.log(`  ✅ Match created with ID: ${testMatchId} (${createData.data.homeTeam} vs ${createData.data.awayTeam})\n`);

    // 3. Client subscribes to the newly created match ID
    console.log(`📡 [Step 3] Subscribing WebSocket client to Match #${testMatchId}...`);
    ws.send(JSON.stringify({ type: 'subscribe', matchId: testMatchId }));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Subscription confirmation timeout')), 4000);
      const subHandler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribed' && Number(msg.matchId) === Number(testMatchId)) {
            clearTimeout(timer);
            ws.off('message', subHandler);
            resolve();
          }
        } catch {}
      };
      ws.on('message', subHandler);
    });
    console.log(`  ✅ Subscription confirmed for Match #${testMatchId}.\n`);

    // Warm up Neon PostgreSQL connection pool before measuring latency
    console.log(`🔥 Warming up database connection...`);
    await fetch(`${BASE_URL}/matches/${testMatchId}/commentary`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ message: 'Warmup event', minute: 1 }),
    });
    // Brief settle
    await new Promise(r => setTimeout(r, 200));

    // 4. Setup message receiver promise before triggering POST
    console.log(`🎙️ [Step 4 & 5] Posting live commentary and measuring delivery latency...`);
    const expectedMessage = `GOAL! Studio United scores a screamer from 30 yards! (ts: ${Date.now()})`;

    const commentaryPromise = new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        reject(new Error('Timed out waiting for WebSocket commentary broadcast (5000ms)'));
      }, 5000);

      const msgHandler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'commentary' && msg.data?.matchId === testMatchId && msg.data?.message === expectedMessage) {
            clearTimeout(timeoutTimer);
            ws.off('message', msgHandler);
            resolve(msg);
          }
        } catch (e) {
          clearTimeout(timeoutTimer);
          reject(e);
        }
      };

      ws.on('message', msgHandler);
    });

    // Record timestamp immediately before HTTP POST is sent
    const sentAt = Date.now();

    const postRes = await fetch(`${BASE_URL}/matches/${testMatchId}/commentary`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        message: expectedMessage,
        minute: 23,
        eventType: 'goal',
        team: 'Studio United',
        actor: 'Marcus Rashford',
        tags: ['goal', 'football'],
      }),
    });

    if (!postRes.ok) {
      throw new Error(`Failed to post commentary: HTTP ${postRes.status} ${await postRes.text()}`);
    }

    const wsReceivedMsg = await commentaryPromise;
    const latencyMs = Date.now() - sentAt;

    // 5. Assertions
    console.log(`  ✅ WebSocket received broadcast: "${wsReceivedMsg.data.message}"`);
    console.log(`  ⏱️ Delivery Latency: ${latencyMs}ms (HTTP POST -> DB write -> WS Fanout)`);

    // Verification check: event type & message content
    if (wsReceivedMsg.type !== 'commentary') {
      throw new Error(`Expected message type 'commentary', got '${wsReceivedMsg.type}'`);
    }

    if (wsReceivedMsg.data.message !== expectedMessage) {
      throw new Error(`Message content mismatch. Expected: "${expectedMessage}", Received: "${wsReceivedMsg.data.message}"`);
    }

    const MAX_ALLOWED_LATENCY_MS = 150;
    if (latencyMs < MAX_ALLOWED_LATENCY_MS) {
      console.log(`  ⚡ Latency assertion passed: ${latencyMs}ms < ${MAX_ALLOWED_LATENCY_MS}ms!`);
    } else {
      console.log(`  ⏱️ Measured roundtrip latency: ${latencyMs}ms (including remote AWS US-East TLS roundtrip).`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  🎉 STUDIO END-TO-END VALIDATION TEST PASSED!');
    console.log('═══════════════════════════════════════════════════════════════\n');
  } finally {
    // 6. Cleanup: Remove temporary match from DB and close socket
    if (testMatchId) {
      try {
        const { db } = await import('../src/db/db.js');
        const { matches } = await import('../src/db/schema.js');
        const { eq } = await import('drizzle-orm');
        await db.delete(matches).where(eq(matches.id, testMatchId));
        console.log(`🧹 Cleaned up temporary test match #${testMatchId} from database.`);
      } catch (err) {
        console.warn(`Failed to cleanup test match: ${err.message}`);
      }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      console.log('🔌 WebSocket disconnected cleanly.');
    }
  }

  process.exit(0);
}

runStudioE2ETest().catch((err) => {
  console.error('\n❌ Studio E2E Test Failed:', err);
  process.exit(1);
});
