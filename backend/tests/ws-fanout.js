/**
 * WS Fan-out Latency Test (v2)
 * - Warmup POST before measuring (avoids cold Neon DB connection on Round 1)
 * - 5s timeout per round (DB insert to Neon can spike on cold connection)
 * - Tracks per-round delivery stats
 */
import WebSocket from 'ws';
import http from 'http';

const WS_URL = 'ws://localhost:8000/ws';
const MATCH_ID = process.env.MATCH_ID || '1';
const CLIENT_COUNT = parseInt(process.env.CLIENTS || '50');
const ROUNDS = parseInt(process.env.ROUNDS || '40');
const MSG_TIMEOUT_MS = 5000;

function connect(matchId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', matchId: Number(matchId) }));
      resolve(ws);
    });
    ws.once('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function postCommentary(matchId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message: `fanout-test-${Date.now()}`,
      minute: 42,
      eventType: 'test',
      period: '2nd half',
    });
    const req = http.request(
      {
        hostname: 'localhost', port: 8000,
        path: `/matches/${matchId}/commentary`,
        method: 'POST', agent: false,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 LoadTest/1.0',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, time: Date.now() }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runFanoutTest() {
  console.log(`\n🔌 Connecting ${CLIENT_COUNT} WebSocket clients to match ${MATCH_ID}...`);
  const clients = [];
  const BATCH = 10;
  for (let i = 0; i < CLIENT_COUNT; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, CLIENT_COUNT); j++) {
      batch.push(connect(MATCH_ID).catch(() => null));
    }
    const settled = await Promise.all(batch);
    settled.forEach((ws) => { if (ws) clients.push(ws); });
    if (i + BATCH < CLIENT_COUNT) await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`✅ ${clients.length}/${CLIENT_COUNT} clients connected.\n`);

  // ── WARMUP: fire one POST to warm up the Neon DB connection ──────────────
  console.log(`🔥 Warming up DB connection (discarded)...`);
  try { await postCommentary(MATCH_ID); } catch (_) {}
  await new Promise((r) => setTimeout(r, 500)); // let any stray broadcast clear
  console.log(`✅ Warmup done. Starting ${ROUNDS} measured rounds.\n`);

  const allLatencies = [];
  let totalDelivered = 0;
  let totalExpected = 0;
  const roundStats = [];

  for (let round = 0; round < ROUNDS; round++) {
    const listeners = clients.map((ws) =>
      new Promise((resolve) => {
        const handler = (raw) => {
          try {
            const msg = JSON.parse(raw.data.toString());
            if (msg.type === 'commentary') {
              resolve(Date.now());
              ws.removeEventListener('message', handler);
            }
          } catch (_) {}
        };
        ws.addEventListener('message', handler);
        setTimeout(() => {
          ws.removeEventListener('message', handler);
          resolve(null);
        }, MSG_TIMEOUT_MS);
      })
    );

    const postTime = Date.now();
    try { await postCommentary(MATCH_ID); } catch (_) { continue; }

    const results = await Promise.all(listeners);
    const delivered = results.filter(Boolean).length;
    totalExpected += CLIENT_COUNT;
    totalDelivered += delivered;
    results.forEach((t) => { if (t !== null) allLatencies.push(t - postTime); });
    roundStats.push({ round: round + 1, delivered, total: CLIENT_COUNT });

    process.stdout.write(`  Round ${round + 1}/${ROUNDS}: ${delivered}/${CLIENT_COUNT} ✓\r`);

    // 300ms between rounds so events don't bleed into each other
    await new Promise((r) => setTimeout(r, 300));
  }

  clients.forEach((ws) => ws.close());

  allLatencies.sort((a, b) => a - b);
  const p50 = allLatencies[Math.floor(allLatencies.length * 0.50)];
  const p95 = allLatencies[Math.floor(allLatencies.length * 0.95)];
  const p99 = allLatencies[Math.floor(allLatencies.length * 0.99)];
  const avg = Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);
  const dropRate = (((totalExpected - totalDelivered) / totalExpected) * 100).toFixed(2);

  const perfectRounds = roundStats.filter((r) => r.delivered === r.total).length;
  const failedRounds  = roundStats.filter((r) => r.delivered < r.total);

  console.log(`\n\n📊 FAN-OUT RESULTS (${CLIENT_COUNT} clients × ${ROUNDS} rounds, localhost → Neon PostgreSQL)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total events expected  : ${totalExpected}`);
  console.log(`  Total delivered        : ${totalDelivered}`);
  console.log(`  Drop rate              : ${dropRate}%`);
  console.log(`  Perfect rounds (100%)  : ${perfectRounds}/${ROUNDS}`);
  if (failedRounds.length) {
    failedRounds.forEach((r) =>
      console.log(`    ⚠️  Round ${r.round}: ${r.delivered}/${r.total} delivered`)
    );
  }
  console.log(`  Avg end-to-end latency : ${avg}ms`);
  console.log(`  p50                    : ${p50}ms`);
  console.log(`  p95                    : ${p95}ms`);
  console.log(`  p99                    : ${p99}ms`);
  console.log(`  Note: latency = POST send → WS message received`);
  console.log(`        (includes Neon DB insert over internet)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

runFanoutTest().catch((e) => { console.error('Test failed:', e); process.exit(1); });
