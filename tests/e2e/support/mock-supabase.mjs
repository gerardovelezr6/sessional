// A small in-memory stand-in for the Supabase endpoints the server uses (tenant lookup, sign-in,
// invitations, people), so browser tests run without a database. The real SQL behind these
// functions is tested separately in tests/db. It also checks which key the server sends where.
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 3199);
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key';

const tid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANTS = {
  alpha: { kind: 'tenant', id: tid(1), slug: 'alpha', name: 'School Alpha', status: 'active' },
  beta: { kind: 'tenant', id: tid(2), slug: 'beta', name: 'School Beta', status: 'active' },
  'beta-old': { kind: 'renamed', slug: 'beta' },
  frozen: { kind: 'tenant', id: tid(3), slug: 'frozen', name: 'Frozen School', status: 'suspended' },
  gamma: { kind: 'tenant', id: tid(4), slug: 'gamma', name: 'New School', status: 'trialing' },
  delta: { kind: 'tenant', id: tid(5), slug: 'delta', name: 'Colegio Delta', status: 'active' },
  epsilon: { kind: 'tenant', id: tid(6), slug: 'epsilon', name: 'Settings School', status: 'active' },
  zeta: { kind: 'tenant', id: tid(7), slug: 'zeta', name: 'Design School', status: 'active' },
  eta: { kind: 'tenant', id: tid(8), slug: 'eta', name: 'Logo School', status: 'active' },
  theta: { kind: 'tenant', id: tid(9), slug: 'theta', name: 'Advanced School', status: 'active' },
  iota: { kind: 'tenant', id: tid(10), slug: 'iota', name: 'Import School', status: 'active' },
  kappa: { kind: 'tenant', id: tid(11), slug: 'kappa', name: 'مدرسة كابا', status: 'active' },
  lambda: { kind: 'tenant', id: tid(12), slug: 'lambda', name: 'Lambda School', status: 'active' },
};
const HOSTS = { 'mun.example.test': TENANTS.alpha };

const ROLES = [
  { key: 'owner', name: { en: 'Owner', es: 'Propietario' }, rank: 0, all: true, permissions: [] },
  { key: 'high_command', name: { en: 'High Command' }, rank: 20, all: false, permissions: ['users.view', 'users.manage'] },
  { key: 'chair', name: { en: 'Chair', es: 'Mesa' }, rank: 30, all: false, permissions: [] },
];
// A brand-new school has only the Owner role until its owner adds more.
const EXTRA_ROLES = { [tid(4)]: [] };
const rolesIn = (tenant) => (EXTRA_ROLES[tenant] ? [ROLES[0], ...EXTRA_ROLES[tenant]] : ROLES);
const roleOf = (key) => [...ROLES, ...Object.values(EXTRA_ROLES).flat()].find((r) => r.key === key);

const users = new Map(); // id -> { id, email, password, full_name, password_set }
const memberships = []; // { tenant_id, user_id, role_key, status }
const sessions = new Map(); // access token -> user id
const refreshTokens = new Map(); // refresh token -> user id
const links = new Map(); // token hash -> { userId, type }

function addUser(email, password, full_name, password_set = !!password) {
  const u = { id: randomUUID(), email, password, full_name, password_set };
  users.set(u.id, u);
  return u;
}
const byEmail = (email) => [...users.values()].find((u) => u.email === email);
const seed = (email, name, tenant, role) => memberships.push({ tenant_id: tenant, user_id: addUser(email, 'correct-password', name).id, role_key: role, status: 'active' });
seed('owner@alpha.test', 'Olivia Owner', tid(1), 'owner');
seed('hc@alpha.test', 'Hector Command', tid(1), 'high_command');
seed('chair@alpha.test', 'Carla Chair', tid(1), 'chair');
seed('owner@beta.test', 'Bruno Beta', tid(2), 'owner');
seed('owner@gamma.test', 'Gina Gamma', tid(4), 'owner');
seed('owner@delta.test', 'Diego Delta', tid(5), 'owner');
seed('owner@epsilon.test', 'Erin Epsilon', tid(6), 'owner');
seed('chair@epsilon.test', 'Cy Chair', tid(6), 'chair');
seed('owner@zeta.test', 'Zoe Zeta', tid(7), 'owner');
seed('owner@eta.test', 'Ella Eta', tid(8), 'owner');
seed('owner@theta.test', 'Theo Theta', tid(9), 'owner');
seed('owner@iota.test', 'Ivy Iota', tid(10), 'owner');
seed('owner@kappa.test', 'Karim Kappa', tid(11), 'owner');
seed('owner@lambda.test', 'Lena Lambda', tid(12), 'owner');

// Published settings per tenant. Delta is a Spanish-language school with a stricter password rule
// and one broken stored value, which must fall back to its default instead of breaking the page.
const CONFIG = {
  // An Arabic school, written right to left, with a few of its own texts.
  [tid(11)]: {
    locale: { version: 1, schema_version: 1, data: { enabledLocales: ['ar', 'en'], defaultLocale: 'ar' } },
    translations: { version: 1, schema_version: 1, data: { messages: { ar: { 'auth.signIn.title': 'تسجيل الدخول إلى {name}', 'auth.signIn': 'دخول' } } } },
  },
  [tid(5)]: {
    locale: { version: 2, schema_version: 1, data: { defaultLocale: 'es' } },
    people: { version: 1, schema_version: 1, data: { passwordMinLength: 12 } },
    theme: { version: 1, schema_version: 1, data: { preset: 'flat-institutional', brand: '#7A1F2B', colorMode: 'light' } },
    identity: { version: 3, schema_version: 1, data: { tagline: { es: 'La diplomacia primero', en: 'Diplomacy first' }, timeZone: 'Nowhere/Land' } },
  },
};
addUser('stranger@else.test', 'correct-password', 'Sam Stranger');
// Belongs to two schools, plus a suspended one that must not be listed.
seed('multi@else.test', 'Mo Multi', tid(1), 'chair');
memberships.push({ tenant_id: tid(2), user_id: byEmail('multi@else.test').id, role_key: 'high_command', status: 'active' });
memberships.push({ tenant_id: tid(3), user_id: byEmail('multi@else.test').id, role_key: 'chair', status: 'active' });

function issue(userId, lifetimeSeconds = 3600) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const access = `${b64({ alg: 'none' })}.${b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds, jti: randomUUID() })}.x`;
  const refresh = randomBytes(12).toString('hex');
  sessions.set(access, userId);
  refreshTokens.set(refresh, userId);
  return { access_token: access, refresh_token: refresh, expires_in: lifetimeSeconds, token_type: 'bearer', user: { id: userId } };
}

const memberOf = (userId, tenant) => memberships.find((m) => m.user_id === userId && m.tenant_id === tenant && m.status === 'active');
const can = (userId, tenant, perm) => {
  const role = roleOf(memberOf(userId, tenant)?.role_key);
  return !!role && (role.all || role.permissions.includes(perm));
};

const rpcs = {
  resolve_tenant: ({ p_slug, p_host }) => {
    if (p_slug === 'broken') return { status: 500, body: { message: 'boom' } };
    if (p_slug === 'stalled') return { hang: true };
    return { body: (p_slug && TENANTS[p_slug]) || (p_host && HOSTS[p_host]) || { kind: 'none' } };
  },
  tenant_context: ({ p_tenant }, userId) => {
    const u = users.get(userId);
    const m = memberOf(userId, p_tenant);
    const r = roleOf(m?.role_key);
    return {
      body: {
        user: { id: u.id, email: u.email, full_name: u.full_name, locale: u.locale ?? null },
        membership: r ? { role_key: r.key, role_name: r.name, rank: r.rank, all_permissions: r.all, permissions: r.permissions } : null,
      },
    };
  },
  people_list: ({ p_tenant }, userId) => {
    const mine = memberOf(userId, p_tenant);
    if (!mine) return { body: { members: [], roles: [] } };
    const visible = memberships.filter((m) => m.tenant_id === p_tenant && (can(userId, p_tenant, 'users.view') || m.user_id === userId));
    const members = visible
      .map((m) => ({ user_id: m.user_id, email: users.get(m.user_id).email, full_name: users.get(m.user_id).full_name, role_key: m.role_key, role_name: roleOf(m.role_key).name, rank: roleOf(m.role_key).rank, status: m.status, password_set: users.get(m.user_id).password_set }))
      .sort((a, b) => a.rank - b.rank || a.email.localeCompare(b.email));
    const roles = rolesIn(p_tenant).filter((r) => r.rank >= roleOf(mine.role_key).rank).map((r) => ({ key: r.key, name: r.name, rank: r.rank }));
    return { body: { members, roles } };
  },
  add_member: ({ p_tenant, p_user, p_role, p_status }, userId) => {
    if (!can(userId, p_tenant, 'users.manage')) return { status: 403, body: { code: '42501', message: 'new row violates row-level security policy' } };
    if (roleOf(p_role).rank < roleOf(memberOf(userId, p_tenant).role_key).rank) return { status: 403, body: { code: '42501', message: 'You cannot grant a role senior to your own' } };
    if (memberships.some((m) => m.tenant_id === p_tenant && m.user_id === p_user)) return { status: 409, body: { code: '23505', message: 'duplicate key value' } };
    const row = { tenant_id: p_tenant, user_id: p_user, role_key: p_role, status: p_status ?? 'invited' };
    memberships.push(row);
    return { body: row };
  },
  apply_role_preset: ({ p_tenant, p_roles }, userId) => {
    if (!can(userId, p_tenant, 'roles.manage')) return { status: 403, body: { code: '42501', message: 'new row violates row-level security policy' } };
    const existing = rolesIn(p_tenant).map((r) => r.key);
    const fresh = p_roles.filter((r) => !existing.includes(r.key)).map((r) => ({ key: r.key, name: r.name, rank: r.rank, all: false, permissions: r.permissions }));
    (EXTRA_ROLES[p_tenant] ??= []).push(...fresh);
    return { body: { added: fresh.length } };
  },
  config_published: ({ p_tenant }) => {
    const live = Object.fromEntries(
      Object.entries(EDITS[p_tenant] ?? {})
        .filter(([, s]) => s.published_version)
        .map(([name, s]) => [name, { version: s.published_version, ...s.versions.find((v) => v.version === s.published_version).stored }]),
    );
    return { body: { ...(CONFIG[p_tenant] ?? {}), ...live } };
  },
  config_editor_state: ({ p_tenant }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return { body: {} };
    return {
      body: Object.fromEntries(
        Object.entries(EDITS[p_tenant] ?? {}).map(([name, s]) => [name, {
          published_version: s.published_version,
          published: s.published_version ? s.versions.find((v) => v.version === s.published_version).stored : null,
          draft: s.draft,
          history: [...s.versions].reverse().map((v) => ({ version: v.version, note: v.note, rolled_back_from: v.rolled_back_from, created_at: v.created_at, created_by_name: users.get(v.created_by)?.full_name ?? null })),
        }]),
      ),
    };
  },
  config_save_draft: ({ p_tenant, p_section, p_data, p_schema_version }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return DENIED;
    const s = sectionOf(p_tenant, p_section);
    s.draft = { data: p_data, schema_version: p_schema_version, updated_at: new Date().toISOString() };
    return { body: { section: p_section, draft: p_data } };
  },
  config_discard_draft: ({ p_tenant, p_section }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return { body: null };
    const s = sectionOf(p_tenant, p_section);
    if (!s.draft) return { body: null };
    s.draft = null;
    return { body: { section: p_section, draft: null } };
  },
  config_publish: ({ p_tenant, p_section, p_note }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return { body: null };
    const s = sectionOf(p_tenant, p_section);
    if (!s.draft) return { body: null };
    const stored = { data: s.draft.data, schema_version: s.draft.schema_version };
    s.draft = null;
    return { body: append(s, stored, p_note, null, userId) };
  },
  config_rollback: ({ p_tenant, p_section, p_version, p_note }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return { body: null };
    const s = sectionOf(p_tenant, p_section);
    const old = s.versions.find((v) => v.version === p_version);
    return { body: old ? append(s, old.stored, p_note, p_version, userId) : null };
  },
  set_my_locale: ({ p_locale }, userId) => {
    if (p_locale !== null && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(p_locale)) return { status: 400, body: { code: '22023', message: 'invalid language tag' } };
    users.get(userId).locale = p_locale;
    return { body: { id: userId, locale: p_locale } };
  },
  my_conferences: (_args, userId) => {
    const visible = Object.values(TENANTS).filter((t) => t.kind === 'tenant' && !['suspended', 'deleted'].includes(t.status));
    return {
      body: memberships
        .filter((m) => m.user_id === userId && m.status === 'active')
        .map((m) => ({ m, t: visible.find((t) => t.id === m.tenant_id) }))
        .filter((x) => x.t)
        .map(({ m, t }) => ({ slug: t.slug, name: t.name, role_key: m.role_key, role_name: roleOf(m.role_key).name }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    };
  },
  find_account: ({ p_email }) => {
    const u = byEmail(String(p_email).trim().toLowerCase());
    return { body: u ? { id: u.id, password_set: u.password_set } : null };
  },
  complete_onboarding: ({ p_user }) => {
    const u = users.get(p_user);
    if (!u) return { body: null };
    u.password_set = true;
    const pending = memberships.filter((m) => m.user_id === p_user && m.status === 'invited');
    pending.forEach((m) => (m.status = 'active'));
    return { body: { user_id: p_user, activated: pending.length } };
  },
};
// Settings being edited in the tests: tenant -> section -> { published_version, draft, versions }.
const EDITS = {};
// Uploaded files: path -> { type, bytes }.
const FILES = new Map();
const DENIED = { status: 403, body: { code: '42501', message: 'new row violates row-level security policy' } };
function sectionOf(tenant, section) {
  return ((EDITS[tenant] ??= {})[section] ??= { published_version: null, draft: null, versions: [] });
}
function append(s, stored, note, rolledBackFrom, userId) {
  const version = s.versions.length + 1;
  s.versions.push({ version, stored, note: note ?? '', rolled_back_from: rolledBackFrom, created_at: new Date().toISOString(), created_by: userId });
  s.published_version = version;
  return { version, note: note ?? '', rolled_back_from: rolledBackFrom };
}
const SERVICE_ONLY = new Set(['resolve_tenant', 'find_account', 'complete_onboarding', 'config_published']);

const auth = {
  'POST /auth/v1/token?grant_type=password': ({ email, password }) => {
    const u = byEmail(email);
    return u && u.password && u.password === password ? { body: issue(u.id) } : { status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
  },
  'POST /auth/v1/token?grant_type=refresh_token': ({ refresh_token }) => {
    const userId = refreshTokens.get(refresh_token);
    if (!userId) return { status: 400, body: { error_code: 'refresh_token_not_found' } };
    refreshTokens.delete(refresh_token);
    return { body: issue(userId) };
  },
  'POST /auth/v1/verify': ({ token_hash, type }) => {
    const link = links.get(token_hash);
    if (!link || link.type !== type) return { status: 403, body: { error_code: 'otp_expired', msg: 'Email link is invalid or has expired' } };
    links.delete(token_hash); // one time only
    return { body: issue(link.userId) };
  },
  'PUT /auth/v1/user': ({ password }, userId) => {
    if (!userId) return { status: 401, body: {} };
    if (password === 'rejected-by-service') return { status: 422, body: { error_code: 'weak_password' } };
    users.get(userId).password = password;
    return { body: { id: userId } };
  },
  'POST /auth/v1/logout?scope=local': (_b, _u, token) => {
    sessions.delete(token);
    return { status: 204, body: {} };
  },
  'POST /auth/v1/admin/generate_link': ({ type, email, data }, _u, token) => {
    if (token !== SERVICE) return { status: 401, body: {} };
    let u = byEmail(email);
    if (type === 'invite' && u?.password_set) return { status: 422, body: { error_code: 'email_exists', msg: 'A user with this email address has already been registered' } };
    if (!u) u = addUser(email, null, data?.full_name ?? '', false);
    for (const [hash, l] of links) if (l.userId === u.id) links.delete(hash); // a new link replaces the old one
    const hashed_token = randomBytes(28).toString('hex');
    links.set(hashed_token, { userId: u.id, type });
    return { body: { id: u.id, email, hashed_token, verification_type: type } };
  },
};

createServer((req, res) => {
  const send = ({ status = 200, body = {}, hang = false }) => {
    if (hang) return;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 204 ? undefined : JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return send({ body: { ok: true } });
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const bytes = Buffer.concat(chunks);

    // File store: uploads (service key only) and public reads.
    const upload = /^\/storage\/v1\/object\/public-assets\/(.+)$/.exec(req.url ?? '');
    if (req.method === 'POST' && upload) {
      if (req.headers.apikey !== SERVICE || req.headers.authorization !== `Bearer ${SERVICE}`) return send({ status: 401, body: { message: 'bad key' } });
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.headers['content-type'])) return send({ status: 415, body: { message: 'mime type not allowed' } });
      FILES.set(upload[1], { type: req.headers['content-type'], bytes });
      return send({ body: { Key: `public-assets/${upload[1]}` } });
    }
    const read = /^\/storage\/v1\/object\/public\/public-assets\/(.+)$/.exec(req.url ?? '');
    if (req.method === 'GET' && read) {
      const file = FILES.get(read[1]);
      if (!file) return send({ status: 404, body: { message: 'not found' } });
      res.writeHead(200, { 'content-type': file.type });
      return res.end(file.bytes);
    }

    const raw = bytes.toString('utf8');
    const body = raw ? JSON.parse(raw) : {};
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const key = req.headers.apikey;

    // Test hook: make a signed-in person's access token expire, to exercise session renewal.
    if (req.method === 'POST' && req.url === '/__test/short-session') {
      const u = byEmail(body.email);
      return send({ body: issue(u.id, 5) });
    }

    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(req.url ?? '');
    if (req.method === 'POST' && rpc && rpcs[rpc[1]]) {
      if (SERVICE_ONLY.has(rpc[1])) {
        if (key !== SERVICE || token !== SERVICE) return send({ status: 401, body: { code: '42501', message: 'permission denied' } });
        return send(rpcs[rpc[1]](body));
      }
      const userId = sessions.get(token);
      if (key !== ANON || !userId) return send({ status: 401, body: { code: 'PGRST301', message: 'JWT invalid' } });
      return send(rpcs[rpc[1]](body, userId));
    }

    const handler = auth[`${req.method} ${req.url}`];
    if (handler) {
      if (key !== ANON && key !== SERVICE) return send({ status: 401, body: {} });
      return send(handler(body, sessions.get(token), token));
    }
    send({ status: 404, body: { message: `no mock for ${req.method} ${req.url}` } });
  });
}).listen(PORT, () => console.log(`mock supabase on ${PORT}`));
