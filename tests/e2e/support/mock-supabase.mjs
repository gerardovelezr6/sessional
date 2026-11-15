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
  mumun: { kind: 'tenant', id: tid(13), slug: 'mumun', name: 'Committee School', status: 'active' },
  console: { kind: 'tenant', id: tid(14), slug: 'console', name: 'Console School', status: 'active' },
  floor: { kind: 'tenant', id: tid(15), slug: 'floor', name: 'Floor School', status: 'active' },
  rules: { kind: 'tenant', id: tid(16), slug: 'rules', name: 'Rules School', status: 'active' },
  grid: { kind: 'tenant', id: tid(17), slug: 'grid', name: 'Grid School', status: 'active' },
  screens: { kind: 'tenant', id: tid(18), slug: 'screens', name: 'Screen School', status: 'active' },
  grades: { kind: 'tenant', id: tid(19), slug: 'grades', name: 'Grade School', status: 'active' },
};
const HOSTS = { 'mun.example.test': TENANTS.alpha };

const ROLES = [
  { key: 'owner', name: { en: 'Owner', es: 'Propietario' }, rank: 0, all: true, permissions: [] },
  { key: 'high_command', name: { en: 'High Command' }, rank: 20, all: false, permissions: ['users.view', 'users.manage'] },
  { key: 'chair', name: { en: 'Chair', es: 'Mesa' }, rank: 30, all: false, permissions: ['committee.run', 'delegates.manage', 'grades.manage'] },
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
seed('owner@mu.test', 'Mia Mu', tid(13), 'owner');
seed('chair@mu.test', 'Chris Chair', tid(13), 'chair');
seed('chair2@mu.test', 'Dana Chair', tid(13), 'chair');
seed('hc@mu.test', 'Hal Command', tid(13), 'high_command');
seed('owner@console.test', 'Olga Console', tid(14), 'owner');
seed('chair@console.test', 'Cam Console', tid(14), 'chair');
seed('chair2@console.test', 'Cleo Console', tid(14), 'chair');
seed('chair@floor.test', 'Fay Floor', tid(15), 'chair');
seed('chair2@floor.test', 'Flo Floor', tid(15), 'chair');
seed('owner@rules.test', 'Rita Rules', tid(16), 'owner');
seed('chair@rules.test', 'Ray Rules', tid(16), 'chair');
seed('owner@grid.test', 'Gil Grid', tid(17), 'owner');
seed('chair@screens.test', 'Sam Screens', tid(18), 'chair');
seed('owner@grades.test', 'Gwen Grades', tid(19), 'owner');
seed('chair@grades.test', 'Gil Grader', tid(19), 'chair');
seed('chair2@grades.test', 'Gus Grader', tid(19), 'chair');

// Published settings per tenant. Delta is a Spanish-language school with a stricter password rule
// and one broken stored value, which must fall back to its default instead of breaking the page.
const CONFIG = {
  // The home page: a banner with dates and venue, committees under categories.
  [tid(17)]: {
    identity: { version: 1, schema_version: 1, data: { tagline: { en: 'Diplomacy in action' }, dates: { en: 'March 12–14, 2027' }, venue: { en: 'City Hall' } } },
    structure: {
      version: 1,
      schema_version: 1,
      data: {
        categories: [{ key: 'general_assembly', name: { en: 'General Assembly' }, color: '#2563EB' }],
        types: [{ key: 'standard', name: { en: 'Standard' }, labelField: { en: 'Country' } }, { key: 'crisis', name: { en: 'Crisis' }, labelField: { en: 'Country' }, confidentialTopic: true }],
      },
    },
  },
  // A school with a Security Council type, where vetoes apply, and the console on one page.
  [tid(16)]: {
    theme: { version: 1, schema_version: 1, data: { consoleLayout: 'single' } },
    structure: {
      version: 1,
      schema_version: 1,
      data: { categories: [], types: [{ key: 'standard', name: { en: 'Standard' }, labelField: { en: 'Country' } }, { key: 'security_council', name: { en: 'Security Council' }, labelField: { en: 'Country' }, veto: true }, { key: 'crisis', name: { en: 'Crisis' }, labelField: { en: 'Country' }, confidentialTopic: true }] },
    },
  },
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
// --- Committees (Phase 5): the same rules as the database, kept in memory. ---
const conferences = []; // { id, tenant_id, name, status, secrets_unlocked_at, created_at }
const committees = []; // { id, tenant_id, conference_id, name, ..., sort_order }
const chairs = []; // { committee_id, user_id }
const delegates = []; // { id, committee_id, label, name, group_key, flag, extra, created_at }
const secrets = new Map(); // committee id -> topic
const activeConference = (tenant) => conferences.filter((f) => f.tenant_id === tenant && f.status === 'active').at(-1) ?? null;
const committeeById = (id) => committees.find((c) => c.id === id);
const isChairOf = (userId, id) => chairs.some((c) => c.committee_id === id && c.user_id === userId);
const manages = (userId, tenant) => can(userId, tenant, 'committee.manage');
const seesDelegates = (userId, c) => manages(userId, c.tenant_id) || (isChairOf(userId, c.id) && (can(userId, c.tenant_id, 'committee.run') || can(userId, c.tenant_id, 'delegates.manage')));
const editsDelegates = (userId, c) => manages(userId, c.tenant_id) || (isChairOf(userId, c.id) && can(userId, c.tenant_id, 'delegates.manage'));
const nameOf = (id) => {
  const u = users.get(id);
  return u.full_name || u.email;
};
const pick = (c) => ({ ...c });
// The status words every member sees: in session, between sessions or not started; what the floor does.
const liveStatus = (id) => {
  const mine = liveSessions.filter((x) => x.committee_id === id);
  const state = live.get(id)?.state ?? {};
  return {
    status: mine.some((x) => !x.closed_at) ? 'in_session' : mine.length ? 'between_sessions' : 'not_started',
    session_number: mine.length ? Math.max(...mine.map((x) => x.number)) : null,
    mode: state.vote ? 'voting' : state.caucus ? state.caucus.kind : 'formal',
    caucus_key: state.caucus?.key ?? null,
  };
};
const delegateRow = (d) => ({ id: d.id, label: d.label, name: d.name, group_key: d.group_key, flag: d.flag, extra: d.extra });

// Console School: one committee, ready to run, chaired by Cam and Cleo, with five delegations.
{
  const conf = { id: randomUUID(), tenant_id: tid(14), name: 'Console MUN', status: 'active', secrets_unlocked_at: null, created_at: new Date().toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9000-000000000001', tenant_id: tid(14), conference_id: conf.id, name: 'Disarmament', abbreviation: 'DISEC', topic: '', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@console.test').id }, { committee_id: c.id, user_id: byEmail('chair2@console.test').id });
  for (const label of ['Brazil', 'China', 'France', 'Kenya', 'Mexico']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
}
// Rules School: a Security Council with two veto holders, for motions, votes and documents.
{
  const conf = { id: randomUUID(), tenant_id: tid(16), name: 'Rules MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9000-000000000003', tenant_id: tid(16), conference_id: conf.id, name: 'Security Council', abbreviation: 'SC', topic: '', description: '', category_key: null, type_key: 'security_council', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@rules.test').id });
  for (const label of ['Brazil', 'China', 'France', 'Kenya', 'Mexico']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
}

// Floor School: the same, for speakers, timers and caucuses.
{
  const conf = { id: randomUUID(), tenant_id: tid(15), name: 'Floor MUN', status: 'active', secrets_unlocked_at: null, created_at: new Date().toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9000-000000000002', tenant_id: tid(15), conference_id: conf.id, name: 'Human Rights', abbreviation: 'HRC', topic: '', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@floor.test').id }, { committee_id: c.id, user_id: byEmail('chair2@floor.test').id });
  for (const label of ['Brazil', 'China', 'France', 'Kenya', 'Mexico']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
}

Object.assign(rpcs, {
  current_conference: ({ p_tenant }, userId) => ({ body: memberOf(userId, p_tenant) ? activeConference(p_tenant) : null }),
  conference_start: ({ p_tenant, p_name }, userId) => {
    if (!manages(userId, p_tenant)) return DENIED;
    const row = { id: randomUUID(), tenant_id: p_tenant, name: String(p_name).trim(), status: 'active', secrets_unlocked_at: null, created_at: new Date().toISOString() };
    conferences.push(row);
    return { body: row };
  },
  committees_overview: ({ p_tenant }, userId) => {
    if (!memberOf(userId, p_tenant)) return { body: { conference: null, committees: [] } };
    const conf = activeConference(p_tenant);
    const list = conf ? committees.filter((c) => c.conference_id === conf.id).sort((a, b) => a.sort_order - b.sort_order) : [];
    return {
      body: {
        conference: conf,
        committees: list.map((c) => ({
          id: c.id, name: c.name, abbreviation: c.abbreviation, topic: c.topic, category_key: c.category_key, type_key: c.type_key, language: c.language, sort_order: c.sort_order,
          delegates: seesDelegates(userId, c) ? delegates.filter((d) => d.committee_id === c.id).length : 0,
          chairs: chairs.filter((x) => x.committee_id === c.id).map((x) => ({ user_id: x.user_id, name: nameOf(x.user_id) })),
          is_chair: isChairOf(userId, c.id),
          live: liveStatus(c.id),
        })),
      },
    };
  },
  committee_detail: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !memberOf(userId, c.tenant_id)) return { body: null };
    const conf = conferences.find((f) => f.id === c.conference_id);
    const inConf = committees.filter((x) => x.conference_id === conf.id);
    const half = conf.secrets_unlock_rule === 'half_in_session' && 2 * inConf.filter((x) => liveSessions.some((s) => s.committee_id === x.id && !s.closed_at)).length >= inConf.length;
    const unlocked = half || (conf.secrets_unlocked_at && new Date(conf.secrets_unlocked_at).getTime() <= Date.now());
    const readsSecret = manages(userId, c.tenant_id) || can(userId, c.tenant_id, 'crisis.view') || (unlocked && isChairOf(userId, c.id) && can(userId, c.tenant_id, 'committee.run'));
    return {
      body: {
        committee: pick(c),
        conference: { id: conf.id, name: conf.name, secrets_unlocked_at: conf.secrets_unlocked_at },
        chairs: chairs.filter((x) => x.committee_id === c.id).map((x) => x.user_id),
        delegates: seesDelegates(userId, c)
          ? delegates
              .filter((d) => d.committee_id === c.id)
              .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
              .map(delegateRow)
          : [],
        secret: readsSecret ? (secrets.get(c.id) ?? null) : null,
      },
    };
  },
  committee_save: ({ p_tenant, p_data }, userId) => {
    if (!manages(userId, p_tenant)) return DENIED;
    const fields = {
      name: String(p_data.name).trim(), abbreviation: p_data.abbreviation ?? '', topic: p_data.topic ?? '', description: p_data.description ?? '',
      category_key: p_data.category_key || null, type_key: p_data.type_key || 'standard', language: p_data.language || null,
    };
    if (!p_data.id) {
      const conf = activeConference(p_tenant);
      if (!conf) return { status: 400, body: { code: '22023', message: 'no conference' } };
      const mine = committees.filter((c) => c.conference_id === conf.id);
      const row = { id: randomUUID(), tenant_id: p_tenant, conference_id: conf.id, ...fields, sort_order: mine.length ? Math.max(...mine.map((c) => c.sort_order)) + 1 : 0, created_at: new Date().toISOString() };
      committees.push(row);
      return { body: row };
    }
    const c = committeeById(p_data.id);
    if (!c || c.tenant_id !== p_tenant) return { body: null };
    Object.assign(c, fields);
    return { body: pick(c) };
  },
  committee_delete: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !manages(userId, c.tenant_id)) return { body: null };
    committees.splice(committees.indexOf(c), 1);
    for (let i = delegates.length - 1; i >= 0; i--) if (delegates[i].committee_id === c.id) delegates.splice(i, 1);
    for (let i = chairs.length - 1; i >= 0; i--) if (chairs[i].committee_id === c.id) chairs.splice(i, 1);
    secrets.delete(c.id);
    return { body: { id: c.id } };
  },
  committees_reorder: ({ p_tenant, p_ids }, userId) => {
    if (!manages(userId, p_tenant)) return { body: 0 };
    let moved = 0;
    p_ids.forEach((id, i) => {
      const c = committeeById(id);
      if (c && c.tenant_id === p_tenant) {
        c.sort_order = i + 1;
        moved++;
      }
    });
    return { body: moved };
  },
  committee_set_chairs: ({ p_committee, p_users }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !manages(userId, c.tenant_id)) return { body: null };
    if (p_users.some((u) => !memberships.some((m) => m.user_id === u && m.tenant_id === c.tenant_id))) return { status: 409, body: { code: '23503', message: 'foreign key violation' } };
    for (let i = chairs.length - 1; i >= 0; i--) if (chairs[i].committee_id === c.id) chairs.splice(i, 1);
    p_users.forEach((u) => chairs.push({ committee_id: c.id, user_id: u }));
    return { body: [...p_users].sort() };
  },
  committee_set_secret: ({ p_committee, p_topic }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !manages(userId, c.tenant_id)) return { body: null };
    const topic = String(p_topic ?? '').trim();
    if (topic) secrets.set(c.id, topic);
    else secrets.delete(c.id);
    return { body: { committee_id: c.id, topic: topic || null } };
  },
  conference_set_unlock: ({ p_conference, p_at }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !manages(userId, f.tenant_id)) return { body: null };
    f.secrets_unlocked_at = p_at;
    return { body: { id: f.id, secrets_unlocked_at: p_at } };
  },
  delegates_add: ({ p_committee, p_rows }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !editsDelegates(userId, c)) return DENIED;
    const added = p_rows.map((r) => {
      const d = { id: randomUUID(), committee_id: c.id, label: String(r.label).trim(), name: String(r.name ?? '').trim(), group_key: r.group_key || null, flag: r.flag || null, extra: r.extra ?? {}, created_at: new Date().toISOString() };
      delegates.push(d);
      return { id: d.id, label: d.label };
    });
    return { body: added };
  },
  delegate_update: ({ p_delegate, p_data }, userId) => {
    const d = delegates.find((x) => x.id === p_delegate);
    if (!d || !editsDelegates(userId, committeeById(d.committee_id))) return { body: null };
    Object.assign(d, { label: String(p_data.label).trim(), name: String(p_data.name ?? '').trim(), group_key: p_data.group_key || null, flag: p_data.flag || null, extra: p_data.extra ?? d.extra });
    return { body: delegateRow(d) };
  },
  delegate_delete: ({ p_delegate }, userId) => {
    const d = delegates.find((x) => x.id === p_delegate);
    if (!d || !editsDelegates(userId, committeeById(d.committee_id))) return { body: null };
    delegates.splice(delegates.indexOf(d), 1);
    return { body: { id: d.id } };
  },
});

// --- Live committees (Phase 6): commits only from the server role, once per command id. ---
const live = new Map(); // committee id -> { revision, barrier, state }
const commands = new Map(); // command id -> { committee_id, revision }
const liveSessions = []; // { id, committee_id, number, protocol, opened_at, closed_at }
const rollCalls = []; // { id, session_id, taken_at, entries }
const speechLog = []; // { session_id, label, list, seconds, started_at }
const voteLog = []; // { session_id, ...vote }
const warningLog = []; // { committee_id, ...warning }
const documents = []; // documents rows
const canRun = (userId, c) => {
  const role = c && roleOf(memberOf(userId, c.tenant_id)?.role_key);
  return !!role && (role.all || (role.permissions.includes('committee.run') && (isChairOf(userId, c.id) || role.key !== 'chair')));
};
const openSession = (id) => liveSessions.filter((x) => x.committee_id === id && !x.closed_at).at(-1) ?? null;
// Test hook: refuse the next N commits with a network failure, to exercise resending.
let dropNext = 0;

// Screen School: one committee with a chair and four delegations (one with a student's name).
{
  const conf = { id: randomUUID(), tenant_id: tid(18), name: 'Screen MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9000-000000000004', tenant_id: tid(18), conference_id: conf.id, name: 'World Health', abbreviation: 'WHO', topic: 'Pandemic preparedness', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@screens.test').id });
  for (const [label, name] of [['Brazil', 'Bea Student'], ['China', ''], ['France', ''], ['Kenya', '']]) delegates.push({ id: randomUUID(), committee_id: c.id, label, name, group_key: null, flag: null, extra: {}, created_at: conf.created_at });
}

// Grid School: three committees, one of them in session.
{
  const conf = { id: randomUUID(), tenant_id: tid(17), name: 'Grid MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
  conferences.push(conf);
  const add = (n, name, abbreviation, topic, category_key, type_key) => {
    const c = { id: `00000000-0000-4000-9100-00000000000${n}`, tenant_id: tid(17), conference_id: conf.id, name, abbreviation, topic, description: '', category_key, type_key, language: null, sort_order: n, created_at: conf.created_at };
    committees.push(c);
    return c;
  };
  const disec = add(1, 'Disarmament and Security', 'DISEC', 'Autonomous weapons', 'general_assembly', 'standard');
  add(2, 'Environment Programme', 'UNEP', 'Climate finance', 'general_assembly', 'standard');
  add(3, 'Emergency Cabinet', 'EC', 'This must not show', null, 'crisis');
  liveSessions.push({ id: randomUUID(), committee_id: disec.id, number: 1, protocol: null, opened_at: conf.created_at, closed_at: null });
}

Object.assign(rpcs, {
  committee_can_run: ({ p_committee }, userId) => ({ body: canRun(userId, committeeById(p_committee)) }),
  live_view: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !(canRun(userId, c) || manages(userId, c.tenant_id))) return { body: null };
    const l = live.get(c.id);
    const s = openSession(c.id);
    return { body: { revision: l?.revision ?? 0, state: l?.state ?? {}, session: s ? { id: s.id, number: s.number, opened_at: s.opened_at, protocol: s.protocol } : null } };
  },
  committee_sessions_list: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !(canRun(userId, c) || manages(userId, c.tenant_id))) return { body: [] };
    return {
      body: liveSessions
        .filter((x) => x.committee_id === c.id)
        .sort((a, b) => b.number - a.number)
        .map((x) => ({ id: x.id, number: x.number, opened_at: x.opened_at, closed_at: x.closed_at, roll_calls: rollCalls.filter((r) => r.session_id === x.id), speeches: speechLog.filter((r) => r.session_id === x.id), votes: voteLog.filter((r) => r.session_id === x.id) })),
    };
  },
  live_load: ({ p_committee, p_command }) => {
    const c = committeeById(p_committee);
    if (!c) return { body: null };
    const l = live.get(c.id) ?? { revision: 0, barrier: 0, state: {} };
    const done = commands.get(p_command);
    return {
      body: {
        tenant_id: c.tenant_id, type_key: c.type_key, channel: channelOf(c.id), revision: l.revision, barrier: l.barrier, state: l.state,
        session_protocol: openSession(c.id)?.protocol ?? null,
        sessions_held: liveSessions.filter((x) => x.committee_id === c.id).length,
        delegates: delegates.filter((d) => d.committee_id === c.id).sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase())).map((d) => ({ id: d.id, label: d.label, flag: d.flag, group_key: d.group_key })),
        applied: done && done.committee_id === c.id ? { revision: done.revision } : null,
      },
    };
  },
  live_commit: ({ p_committee, p_command, p_expected, p_commutes, p_state, p_effects }) => {
    const done = commands.get(p_command);
    if (done) return { body: { revision: done.revision, duplicate: true } };
    const c = committeeById(p_committee);
    if (!c) return { body: null };
    const l = live.get(c.id) ?? { revision: 0, barrier: 0, state: {} };
    if (l.revision !== p_expected) return { body: { conflict: true } };
    const revision = l.revision + 1;
    live.set(c.id, { revision, barrier: p_commutes ? l.barrier : revision, state: p_state });
    commands.set(p_command, { committee_id: c.id, revision });
    for (const e of p_effects) {
      if (e.type === 'session.opened') liveSessions.push({ id: e.id, committee_id: c.id, number: e.number, protocol: e.protocol, opened_at: new Date().toISOString(), closed_at: null });
      if (e.type === 'session.closed') {
        const x = liveSessions.find((y) => y.id === e.id);
        if (x) x.closed_at = new Date().toISOString();
      }
      if (e.type === 'vote.recorded') {
        voteLog.push({ session_id: e.session, id: e.id, title: e.title, subject: e.subject, method: e.method, procedural: e.procedural, tally: e.tally, needed: e.needed, passed: e.passed, vetoed: e.vetoed, closed_at: new Date().toISOString(), ballots: e.method === 'roll_call' ? e.ballots : null });
        if (e.subject.kind === 'document') {
          const d = documents.find((x) => x.id === e.subject.document && x.committee_id === c.id && x.status === 'introduced');
          if (d) d.status = e.passed ? 'passed' : 'failed';
        }
      }
      if (e.type === 'warning.recorded') warningLog.push({ committee_id: c.id, ...e });
      if (e.type === 'speech.recorded') speechLog.push({ session_id: e.session, delegate_id: e.delegate, label: e.label, list: e.list, seconds: e.seconds, started_at: e.startedAt });
      if (e.type === 'rollcall.recorded') rollCalls.push({ id: randomUUID(), session_id: e.session, taken_at: new Date().toISOString(), entries: e.entries });
    }
    // The answer is lost after the change was stored, as on a dropped connection.
    if (dropNext > 0) {
      dropNext--;
      return { hang: true };
    }
    return { body: { revision } };
  },
});

// --- Projection screens and live channels (Phase 7). ---
const displays = []; // { id, tenant_id, committee_id, code, secret_hash, name, layout, sound, paired_at, last_seen_at, created_at }
const channels = new Map(); // committee id -> channel
const announcements = []; // { topic, payload }
const channelOf = (id) => {
  if (!channels.has(id)) channels.set(id, randomBytes(32).toString('hex'));
  return channels.get(id);
};
const screenRow = (d) => ({ id: d.id, name: d.name, layout: d.layout, sound: d.sound, paired_at: d.paired_at, last_seen_at: d.last_seen_at });
Object.assign(rpcs, {
  display_register: ({ p_tenant, p_code, p_secret_hash }) => {
    if (displays.some((d) => d.tenant_id === p_tenant && d.code === p_code)) return { status: 409, body: { code: '23505', message: 'duplicate key' } };
    const d = { id: randomUUID(), tenant_id: p_tenant, committee_id: null, code: p_code, secret_hash: p_secret_hash, name: '', layout: 'standard', sound: true, paired_at: null, last_seen_at: null, created_at: Date.now() };
    displays.push(d);
    return { body: { id: d.id, code: d.code } };
  },
  display_pair: ({ p_committee, p_code, p_name, p_layout }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !(canRun(userId, c) || manages(userId, c.tenant_id))) return { status: 403, body: { code: '42501', message: 'not allowed' } };
    const d = displays.find((x) => x.tenant_id === c.tenant_id && x.code === String(p_code).trim().toUpperCase() && !x.committee_id);
    if (!d) return { body: null };
    Object.assign(d, { committee_id: c.id, name: String(p_name ?? '').trim().slice(0, 60), layout: ['standard', 'timer', 'speakers'].includes(p_layout) ? p_layout : 'standard', paired_at: new Date().toISOString() });
    channelOf(c.id);
    return { body: { id: d.id, name: d.name, layout: d.layout } };
  },
  displays_list: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    if (!c || !(canRun(userId, c) || manages(userId, c.tenant_id))) return { body: [] };
    return { body: displays.filter((d) => d.committee_id === c.id).map(screenRow) };
  },
  display_update: ({ p_display, p_name, p_layout, p_sound }, userId) => {
    const d = displays.find((x) => x.id === p_display);
    const c = d && committeeById(d.committee_id);
    if (!c || !(canRun(userId, c) || manages(userId, c.tenant_id))) return { body: null };
    Object.assign(d, { name: p_name, layout: p_layout, sound: p_sound });
    return { body: screenRow(d) };
  },
  display_unpair: ({ p_display }, userId) => {
    const d = displays.find((x) => x.id === p_display);
    const c = d && committeeById(d.committee_id);
    if (!c || !(canRun(userId, c) || manages(userId, c.tenant_id))) return { body: null };
    displays.splice(displays.indexOf(d), 1);
    return { body: { id: d.id } };
  },
  live_channel: ({ p_committee }) => ({ body: committeeById(p_committee) ? channelOf(p_committee) : null }),
  display_view: ({ p_secret_hash }) => {
    const d = displays.find((x) => x.secret_hash === p_secret_hash);
    if (!d) return { body: null };
    d.last_seen_at = new Date().toISOString();
    if (!d.committee_id) return { body: { display: { id: d.id, code: d.code, tenant_id: d.tenant_id, paired: false, expired: Date.now() - d.created_at > 86_400_000 } } };
    const c = committeeById(d.committee_id);
    const l = live.get(c.id) ?? { revision: 0, state: {} };
    return {
      body: {
        display: { id: d.id, tenant_id: d.tenant_id, paired: true, name: d.name, layout: d.layout, sound: d.sound },
        committee: { id: c.id, name: c.name, abbreviation: c.abbreviation, topic: c.topic, type_key: c.type_key, language: c.language },
        revision: l.revision,
        state: l.state,
        channel: channelOf(c.id),
        session_protocol: openSession(c.id)?.protocol ?? null,
        delegates: delegates.filter((x) => x.committee_id === c.id).sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase())).map((x) => ({ id: x.id, label: x.label, flag: x.flag, group_key: x.group_key })),
      },
    };
  },
});

// --- Documents and the unlock rule (Phase 6, part 4). ---
const runsOrManages = (userId, c) => !!c && (canRun(userId, c) || manages(userId, c.tenant_id));
Object.assign(rpcs, {
  documents_list: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    return { body: runsOrManages(userId, c) ? documents.filter((d) => d.committee_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [] };
  },
  document_save: ({ p_committee, p_data }, userId) => {
    const c = committeeById(p_committee);
    if (!runsOrManages(userId, c)) return { body: null };
    const mine = new Set(delegates.filter((d) => d.committee_id === c.id).map((d) => d.id));
    const sponsors = p_data.sponsors ?? [];
    const signatories = p_data.signatories ?? [];
    if ([...sponsors, ...signatories].some((x) => !mine.has(x))) return { status: 400, body: { code: '22023', message: 'sponsors and signatories must be delegates of this committee' } };
    if (!p_data.id) {
      const row = { id: randomUUID(), committee_id: c.id, kind: p_data.kind, code: p_data.code ?? '', title: String(p_data.title).trim(), body: p_data.body ?? '', parent_id: p_data.parent_id || null, sponsors, signatories, status: 'draft', created_at: new Date().toISOString() };
      documents.push(row);
      return { body: row };
    }
    const d = documents.find((x) => x.id === p_data.id && x.committee_id === c.id);
    if (!d) return { body: null };
    Object.assign(d, { code: p_data.code ?? '', title: String(p_data.title).trim(), body: p_data.body ?? '', sponsors, signatories });
    return { body: d };
  },
  document_set_status: ({ p_document, p_status }, userId) => {
    const d = documents.find((x) => x.id === p_document);
    if (!d || !runsOrManages(userId, committeeById(d.committee_id))) return { body: null };
    d.status = p_status;
    return { body: d };
  },
  document_delete: ({ p_document }, userId) => {
    const d = documents.find((x) => x.id === p_document);
    if (!d || !runsOrManages(userId, committeeById(d.committee_id))) return { body: null };
    documents.splice(documents.indexOf(d), 1);
    return { body: { id: d.id } };
  },
  conference_set_unlock_rule: ({ p_conference, p_rule }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !manages(userId, f.tenant_id)) return { body: null };
    f.secrets_unlock_rule = p_rule;
    return { body: { id: f.id, secrets_unlock_rule: p_rule } };
  },
});

// --- Grading and awards (Phase 8). ---
// Grade School: two committees, each with its own chair; a closed session with grades already given.
{
  const conf = { id: randomUUID(), tenant_id: tid(19), name: 'Grade MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
  conferences.push(conf);
  const add = (n, name, abbreviation, chair) => {
    const c = { id: `00000000-0000-4000-9200-00000000000${n}`, tenant_id: tid(19), conference_id: conf.id, name, abbreviation, topic: '', description: '', category_key: null, type_key: 'standard', language: null, sort_order: n, created_at: conf.created_at };
    committees.push(c);
    chairs.push({ committee_id: c.id, user_id: byEmail(chair).id });
    for (const label of ['Brazil', 'China', 'France', 'Kenya']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: label === 'Brazil' ? 'Bea Student' : '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
    return c;
  };
  add(1, 'General Assembly', 'GA', 'chair@grades.test');
  add(2, 'Economic Council', 'ECOSOC', 'chair2@grades.test');
}
const grades = []; // grades rows
const awardRows = []; // { committee_id, award, award_name, delegate_id, label }
const mappings = []; // export_mappings rows
const gradeManager = (userId, c) => {
  const role = c && roleOf(memberOf(userId, c.tenant_id)?.role_key);
  return !!role && (role.all || (role.permissions.includes('grades.manage') && (isChairOf(userId, c.id) || role.key !== 'chair')));
};
const gradesReadable = (userId, c) => !!c && (can(userId, c.tenant_id, 'grades.view') || gradeManager(userId, c));
Object.assign(rpcs, {
  grading_data: ({ p_committee }, userId) => {
    const c = committeeById(p_committee);
    if (!gradesReadable(userId, c)) return { body: null };
    const ds = delegates.filter((d) => d.committee_id === c.id);
    const mine = new Set(ds.map((d) => d.id));
    const sessionIds = new Set(liveSessions.filter((x) => x.committee_id === c.id).map((x) => x.id));
    const counts = new Map();
    for (const sp of speechLog.filter((x) => sessionIds.has(x.session_id) && mine.has(x.delegate_id))) {
      const k = `${sp.delegate_id}|${sp.session_id}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return {
      body: {
        committee: { id: c.id, name: c.name, abbreviation: c.abbreviation, type_key: c.type_key },
        delegates: ds.sort((a, b) => a.label.localeCompare(b.label)).map((d) => ({ id: d.id, label: d.label, name: d.name })),
        sessions: liveSessions.filter((x) => x.committee_id === c.id).sort((a, b) => a.number - b.number).map((x) => ({ id: x.id, number: x.number })),
        grades: grades.filter((g) => g.committee_id === c.id).map((g) => ({ ...g, graded_by: users.get(g.graded_by)?.full_name ?? '' })),
        speeches: [...counts].map(([k, count]) => ({ delegate_id: k.split('|')[0], session_id: k.split('|')[1], count })),
        explanations: voteLog.filter((v) => sessionIds.has(v.session_id) && Array.isArray(v.ballots)).flatMap((v) => v.ballots.filter((b) => b.explained).map((b) => ({ delegate_id: b.delegate_id, session_id: v.session_id }))),
        present: [],
        awards: awardRows.filter((a) => a.committee_id === c.id),
      },
    };
  },
  grade_add: ({ p_committee, p_data }, userId) => {
    const c = committeeById(p_committee);
    const d = delegates.find((x) => x.id === p_data.delegate_id && x.committee_id === p_committee);
    if (!d || !gradesReadable(userId, c)) return { body: null };
    if (!gradeManager(userId, c)) return DENIED;
    const g = { id: randomUUID(), committee_id: c.id, session_id: p_data.session_id || null, delegate_id: d.id, label: d.label, category: p_data.category, category_name: p_data.category_name, level: p_data.level, level_label: p_data.level_label, points: p_data.points, weight: p_data.weight, note: p_data.note ?? '', graded_at: new Date().toISOString(), graded_by: userId };
    grades.push(g);
    return { body: { id: g.id } };
  },
  grade_delete: ({ p_grade }, userId) => {
    const g = grades.find((x) => x.id === p_grade);
    if (!g || !gradeManager(userId, committeeById(g.committee_id))) return { body: false };
    grades.splice(grades.indexOf(g), 1);
    return { body: true };
  },
  award_set: ({ p_committee, p_award, p_name, p_delegates }, userId) => {
    const c = committeeById(p_committee);
    if (!gradeManager(userId, c)) return DENIED;
    const ds = p_delegates.map((id) => delegates.find((x) => x.id === id && x.committee_id === c.id));
    if (ds.some((x) => !x) || new Set(p_delegates).size !== p_delegates.length) return { status: 400, body: { code: '22023', message: 'unknown delegate' } };
    for (let i = awardRows.length - 1; i >= 0; i--) if (awardRows[i].committee_id === c.id && awardRows[i].award === p_award) awardRows.splice(i, 1);
    for (const d of ds) awardRows.push({ committee_id: c.id, award: p_award, award_name: p_name, delegate_id: d.id, label: d.label });
    return { body: ds.map((d) => d.id) };
  },
  export_mappings_list: ({ p_tenant }, userId) => ({ body: memberOf(userId, p_tenant) ? mappings.filter((m) => m.tenant_id === p_tenant).sort((a, b) => a.name.localeCompare(b.name)) : [] }),
  export_mapping_save: ({ p_tenant, p_data }, userId) => {
    if (!can(userId, p_tenant, 'grades.view')) return DENIED;
    if (mappings.some((m) => m.tenant_id === p_tenant && m.name === p_data.name && m.id !== p_data.id)) return { status: 409, body: { code: '23505', message: 'duplicate key' } };
    let m = p_data.id ? mappings.find((x) => x.id === p_data.id && x.tenant_id === p_tenant) : null;
    if (p_data.id && !m) return { body: null };
    if (!m) mappings.push((m = { id: randomUUID(), tenant_id: p_tenant }));
    Object.assign(m, { name: p_data.name, format: p_data.format, columns: p_data.columns, updated_at: new Date().toISOString() });
    return { body: m };
  },
  export_mapping_delete: ({ p_mapping }, userId) => {
    const m = mappings.find((x) => x.id === p_mapping);
    if (!m || !can(userId, m.tenant_id, 'grades.view')) return { body: false };
    mappings.splice(mappings.indexOf(m), 1);
    return { body: true };
  },
});

const SERVICE_ONLY = new Set(['resolve_tenant', 'find_account', 'complete_onboarding', 'config_published', 'live_load', 'live_commit', 'display_register', 'display_view', 'live_channel']);

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
    // Realtime announcements (the server role only); recorded so tests can read them.
    if (req.method === 'POST' && req.url === '/realtime/v1/api/broadcast') {
      if (key !== SERVICE || token !== SERVICE) return send({ status: 401, body: {} });
      for (const m of body.messages ?? []) announcements.push({ topic: m.topic, event: m.event, payload: m.payload, private: m.private });
      return send({ status: 202, body: {} });
    }
    if (req.method === 'GET' && req.url === '/__test/announcements') return send({ body: announcements.slice(-50) });
    if (req.method === 'POST' && req.url === '/__test/drop-commits') {
      dropNext = Number(body.count ?? 1);
      return send({ body: { ok: true } });
    }
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
