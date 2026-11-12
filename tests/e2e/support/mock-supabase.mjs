// A stand-in for the Supabase REST endpoint used by tenant lookup, so browser tests run without a
// database. It also checks that the server (and only the server) sends the service-role key.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 3199);
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key';

const tenant = (slug, name, status = 'active') => ({ kind: 'tenant', id: `00000000-0000-4000-8000-${slug.padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/g, 'a')}`, slug, name, status });
const BY_SLUG = {
  alpha: tenant('alpha', 'School Alpha'),
  beta: tenant('beta', 'School Beta'),
  'beta-old': { kind: 'renamed', slug: 'beta' },
  frozen: tenant('frozen', 'Frozen School', 'suspended'),
};
const BY_HOST = { 'mun.example.test': BY_SLUG.alpha };

createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/rest/v1/rpc/resolve_tenant') return send(404, { message: 'not found' });
  if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: 'bad key' });
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const { p_slug, p_host } = JSON.parse(raw || '{}');
    if (p_slug === 'broken') return send(500, { message: 'boom' });
    if (p_slug === 'stalled') return; // never answers
    send(200, (p_slug && BY_SLUG[p_slug]) || (p_host && BY_HOST[p_host]) || { kind: 'none' });
  });
}).listen(PORT, () => console.log(`mock supabase on ${PORT}`));
