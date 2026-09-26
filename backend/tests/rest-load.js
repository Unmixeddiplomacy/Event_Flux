/**
 * REST + Arcjet Load Test (v2)
 * - Higher concurrency (10 concurrent, respecting Neon 10-conn pool)
 * - Longer duration (60s) for more samples
 * - Status code breakdown
 * - Arcjet: counts exact request number that first triggers 429
 * - Netstat: checks open sockets before/after WS rejection to verify no socket leak
 */
import http from 'http';
import { WebSocket } from 'ws';
import { execSync } from 'child_process';

const CONCURRENCY    = parseInt(process.env.CONCURRENCY || '10');
const DURATION_MS    = parseInt(process.env.DURATION    || '60000');
const MATCH_ID       = process.env.MATCH_ID             || '1';

function request(path, extraHeaders = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request(
      {
        hostname: 'localhost', port: 8000, path, method: 'GET', agent: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LoadTest/1.0)',
          'Accept': 'application/json',
          'Connection': 'close',
          ...extraHeaders,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ ok: res.statusCode < 400, latency: Date.now() - t0, status: res.statusCode })
        );
      }
    );
    req.on('error', (e) => resolve({ ok: false, latency: Date.now() - t0, status: 0, err: e.code }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, latency: 10000, status: 0, err: 'TIMEOUT' }); });
    req.end();
  });
}

async function runEndpoint(name, path, durationMs, concurrency) {
  console.log(`\n⚡ ${name} — ${concurrency} concurrent / ${durationMs / 1000}s`);
  const results = [];
  const deadline = Date.now() + durationMs;
  let active = 0;

  await new Promise((resolve) => {
    function spawn() {
      if (Date.now() >= deadline && active === 0) return resolve();
      if (Date.now() >= deadline) return;
      while (active < concurrency) {
        active++;
        request(path).then((r) => {
          results.push(r);
          active--;
          spawn();
          if (Date.now() >= deadline && active === 0) resolve();
        });
      }
    }
    spawn();
  });

  const latencies = results.map((r) => r.latency).sort((a, b) => a - b);
  const errors    = results.filter((r) => !r.ok);
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const rps = Math.round(results.length / (durationMs / 1000));

  const statusMap = {};
  results.forEach((r) => { statusMap[r.status] = (statusMap[r.status] || 0) + 1; });
  const errCodes  = {};
  errors.forEach((r) => { if (r.err) errCodes[r.err] = (errCodes[r.err] || 0) + 1; });

  const errorRate = ((errors.length / results.length) * 100).toFixed(2);

  console.log(`\n📊 ${name}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total requests : ${results.length.toLocaleString()}`);
  console.log(`  Req/s          : ${rps}`);
  console.log(`  Status codes   : ${JSON.stringify(statusMap)}`);
  console.log(`  Error rate     : ${errorRate}%`);
  if (Object.keys(errCodes).length) console.log(`  Net errors     : ${JSON.stringify(errCodes)}`);
  console.log(`  Avg latency    : ${avg}ms`);
  console.log(`  p50            : ${p50}ms`);
  console.log(`  p95            : ${p95}ms`);
  console.log(`  p99            : ${p99}ms`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return { name, total: results.length, rps, statusMap, errorRate, avg, p50, p95, p99 };
}

async function arcjetSequentialTest() {
  console.log(`\n🔍 Arcjet sequential test — finding exact 429 trigger point...`);
  let first429 = null;
  for (let i = 1; i <= 60; i++) {
    const r = await request('/matches');
    if (r.status === 429 && first429 === null) {
      first429 = i;
    }
    process.stdout.write(`  Request ${i}: HTTP ${r.status}\r`);
    await new Promise((res) => setTimeout(res, 100)); // 100ms apart = ~10 req/s
  }
  console.log(`\n  ✅ First 429 at request #${first429 ?? 'none in 60 attempts'}`);
  console.log(`  Rate limit: 20 req/10s sliding window`);
  return first429;
}

function countWS8000Connections() {
  try {
    const out = execSync(
      'netstat -ano | findstr :8000 | findstr ESTABLISHED', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
    );
    return out.trim().split('\n').filter(Boolean).length;
  } catch { return 0; }
}

async function wsRejectionSocketTest() {
  console.log(`\n🔒 WS pre-handshake rejection — socket leak test...`);
  const before = countWS8000Connections();
  console.log(`  Open :8000 connections before test: ${before}`);

  // Try to open 30 WS connections rapidly (should all be rejected by Arcjet 5 conn/2s)
  const attemptCount = 30;
  let got101 = 0, got4xx = 0, gotErr = 0;

  await Promise.all(Array.from({ length: attemptCount }, () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:8000/ws`);
      ws.once('open', () => { got101++; ws.terminate(); resolve(); });
      ws.once('error', (e) => {
        if (e.message.includes('429') || e.message.includes('403') || e.message.includes('Unexpected server response')) got4xx++;
        else gotErr++;
        resolve();
      });
      setTimeout(() => { ws.terminate(); resolve(); }, 3000);
    })
  ));

  await new Promise((r) => setTimeout(r, 1500)); // wait for sockets to fully close
  const after = countWS8000Connections();

  console.log(`\n📊 WS REJECTION SOCKET LEAK CHECK`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Attempts           : ${attemptCount}`);
  console.log(`  Got 101 (accepted) : ${got101}`);
  console.log(`  Got 4xx (rejected) : ${got4xx}`);
  console.log(`  Net errors         : ${gotErr}`);
  console.log(`  Open connections before : ${before}`);
  console.log(`  Open connections after  : ${after}`);
  console.log(`  Socket leak        : ${after > before + 2 ? '⚠️ POSSIBLE LEAK' : '✅ NONE'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

async function main() {
  console.log('🚀 REST + Arcjet Load Test v2\n');

  // 1. Baseline (Arcjet on — measures real-world throughput)
  const r1 = await runEndpoint('GET /matches (Arcjet ON, 60s)', '/matches', DURATION_MS, CONCURRENCY);
  await new Promise((r) => setTimeout(r, 3000));
  const r2 = await runEndpoint(
    `GET /matches/${MATCH_ID}/commentary (60s)`,
    `/matches/${MATCH_ID}/commentary`,
    DURATION_MS,
    Math.max(2, Math.floor(CONCURRENCY / 2))
  );

  await new Promise((r) => setTimeout(r, 5000)); // let Arcjet window reset

  // 2. Arcjet sequential trigger test
  const first429 = await arcjetSequentialTest();

  // 3. WS socket leak test
  await wsRejectionSocketTest();

  // Summary
  console.log('\n\n📋 FINAL SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  [r1, r2].forEach((r) => {
    const ok  = r.statusMap['200'] || 0;
    const tlr = r.statusMap['429'] || 0;
    console.log(`${r.name}`);
    console.log(`  Req/s: ${r.rps}  |  200: ${ok}  429: ${tlr}  |  p50: ${r.p50}ms  p95: ${r.p95}ms  p99: ${r.p99}ms`);
  });
  if (first429) console.log(`\n  Arcjet 429 trigger: request #${first429} (at ~10 req/s cadence)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
