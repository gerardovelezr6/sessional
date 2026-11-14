#!/usr/bin/env node
// Load test for projection screens.
//
// Registers screens on a school's address, pairs them with committees as a chair, then polls the
// way screens do, and reports latency and errors against thresholds. The full conference-day target
// (ADR-0010) is 60 committees x (1 projector + 25 viewers), polling every 2 s in degraded mode:
//
//   SCREEN_REGISTRATIONS_PER_HOUR=5000 on the server, then
//   node scripts/load-test.mjs --base https://school.staging.example --supabase https://xyz.supabase.co \
//     --anon-key ... --email chair@... --password ... --committees id1,id2,... --per-committee 26 --seconds 120
//
// Thresholds (fail the run when missed): p95 below 800 ms, errors below 1 %.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1]]] : out), []),
);
const base = (args.base ?? 'http://screens.localhost:3100').replace(/\/$/, '');
const supabase = (args.supabase ?? 'http://localhost:3199').replace(/\/$/, '');
const anonKey = args['anon-key'] ?? 'test-anon-key';
const committees = (args.committees ?? '00000000-0000-4000-9000-000000000004').split(',');
const perCommittee = Number(args['per-committee'] ?? 26);
const seconds = Number(args.seconds ?? 30);
const interval = Number(args.interval ?? 2000);
const P95_MS = Number(args['p95-ms'] ?? 800);
const MAX_ERRORS = Number(args['max-errors'] ?? 0.01);

// Node's resolver does not know *.localhost, and fetch will not send another Host header: local
// runs go through node:http to 127.0.0.1 with the school's host name. Anything else uses fetch.
async function request(url, init = {}) {
  const u = new URL(url);
  if (!u.hostname.endsWith('.localhost')) return fetch(url, { ...init, redirect: 'manual' });
  const { request: send } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = send({ host: '127.0.0.1', port: u.port, path: u.pathname + u.search, method: init.method ?? 'GET', headers: { ...(init.headers ?? {}), host: u.host } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: { get: (k) => [res.headers[k.toLowerCase()]].flat().join(', ') },
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function signIn() {
  const res = await fetch(`${supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: args.email ?? 'chair@screens.test', password: args.password ?? 'correct-password' }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function newScreen(token, committee, n) {
  const res = await request(`${base}/display/state`, { method: 'POST' });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const { code } = await res.json();
  const pair = await fetch(`${supabase}/rest/v1/rpc/display_pair`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_committee: committee, p_code: code, p_name: `Load ${n}`, p_layout: 'standard' }),
  });
  if (!pair.ok) throw new Error(`pair failed: ${pair.status}`);
  return cookie;
}

const latencies = [];
let errors = 0;
let requests = 0;

async function poll(cookie, until) {
  // Start at a random point in the interval, as real screens do.
  await new Promise((r) => setTimeout(r, Math.random() * interval));
  while (Date.now() < until) {
    const started = performance.now();
    try {
      const res = await request(`${base}/display/state`, { headers: { cookie } });
      const body = await res.json();
      if (!res.ok || !body.paired) errors++;
    } catch {
      errors++;
    }
    requests++;
    latencies.push(performance.now() - started);
    await new Promise((r) => setTimeout(r, interval));
  }
}

const pct = (q) => {
  const s = [...latencies].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

const token = await signIn();
const cookies = [];
for (const c of committees) for (let i = 0; i < perCommittee; i++) cookies.push(await newScreen(token, c, cookies.length + 1));
console.log(`${cookies.length} screens paired with ${committees.length} committee(s); polling every ${interval} ms for ${seconds} s…`);
const until = Date.now() + seconds * 1000;
await Promise.all(cookies.map((c) => poll(c, until)));

const result = {
  screens: cookies.length,
  requests,
  perSecond: Math.round(requests / seconds),
  errorRate: requests ? errors / requests : 1,
  p50: Math.round(pct(0.5)),
  p95: Math.round(pct(0.95)),
  p99: Math.round(pct(0.99)),
};
console.log(JSON.stringify(result, null, 2));
const ok = result.p95 < P95_MS && result.errorRate < MAX_ERRORS;
console.log(ok ? 'PASS' : `FAIL (thresholds: p95 < ${P95_MS} ms, errors < ${MAX_ERRORS * 100} %)`);
process.exit(ok ? 0 : 1);
