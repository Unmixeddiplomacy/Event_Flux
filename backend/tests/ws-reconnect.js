/**
 * Test 2: WebSocket Reconnection Reliability Test
 * Opens a client, subscribes, force-closes socket every N seconds,
 * verifies subscriptions are restored after each reconnect.
 */
import WebSocket from 'ws';

const WS_URL = 'ws://localhost:8000/ws';
const MATCH_IDS = [1, 2, 3];
const FORCED_DISCONNECTS = parseInt(process.env.DISCONNECTS || '50');
const KILL_INTERVAL_MS = parseInt(process.env.INTERVAL || '1500');

let ws = null;
let reconnectCount = 0;
let subscriptionRestored = 0;
let subscriptionFailed = 0;
const reconnectLatencies = [];

function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}

async function connectAndSubscribe() {
  const t0 = Date.now();
  ws = await openSocket();
  const connectLatency = Date.now() - t0;
  reconnectLatencies.push(connectLatency);

  // subscribe to all matches
  MATCH_IDS.forEach((id) => {
    ws.send(JSON.stringify({ type: 'subscribe', matchId: id }));
  });

  // verify subscriptions by waiting for confirmation messages
  return new Promise((resolve) => {
    const confirmed = new Set();
    const timeout = setTimeout(() => resolve(confirmed), 500);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'subscribed') confirmed.add(Number(msg.matchId));
      if (confirmed.size === MATCH_IDS.length) {
        clearTimeout(timeout);
        resolve(confirmed);
      }
    });
  });
}

async function runReconnectionTest() {
  console.log(`\n🔄 Reconnection Reliability Test`);
  console.log(`   Match IDs: [${MATCH_IDS.join(', ')}]`);
  console.log(`   Forced disconnects: ${FORCED_DISCONNECTS}`);
  console.log(`   Kill interval: ${KILL_INTERVAL_MS}ms\n`);

  for (let i = 0; i < FORCED_DISCONNECTS; i++) {
    const confirmed = await connectAndSubscribe();
    reconnectCount++;

    const restored = MATCH_IDS.every((id) => confirmed.has(id));
    if (restored) {
      subscriptionRestored++;
    } else {
      subscriptionFailed++;
      console.warn(`  ⚠️  Round ${i + 1}: Only ${confirmed.size}/${MATCH_IDS.length} subscriptions confirmed`);
    }

    process.stdout.write(`  Disconnect ${i + 1}/${FORCED_DISCONNECTS} — subscriptions: ${confirmed.size}/${MATCH_IDS.length} ✓\r`);

    // force-kill the socket
    ws.terminate();
    await new Promise((r) => setTimeout(r, KILL_INTERVAL_MS));
  }

  ws?.terminate();

  const sortedLatencies = reconnectLatencies.sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
  const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
  const avg = Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length);

  console.log(`\n\n📊 RECONNECTION RELIABILITY RESULTS`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total forced disconnects     : ${FORCED_DISCONNECTS}`);
  console.log(`  Subscriptions fully restored : ${subscriptionRestored}/${FORCED_DISCONNECTS}`);
  console.log(`  Subscription failures        : ${subscriptionFailed}`);
  console.log(`  Success rate                 : ${((subscriptionRestored / FORCED_DISCONNECTS) * 100).toFixed(1)}%`);
  console.log(`  Avg reconnect latency        : ${avg}ms`);
  console.log(`  p50 reconnect latency        : ${p50}ms`);
  console.log(`  p95 reconnect latency        : ${p95}ms`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

runReconnectionTest().catch((e) => { console.error('Test failed:', e); process.exit(1); });
