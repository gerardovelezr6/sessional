// A small in-memory stand-in for the Supabase endpoints the server uses (tenant lookup, sign-in,
// invitations, people), so browser tests run without a database. The real SQL behind these
// functions is tested separately in tests/db. It also checks which key the server sends where.
import { createHash, createHmac, randomUUID, randomBytes } from 'node:crypto';
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
  site: { kind: 'tenant', id: tid(20), slug: 'site', name: 'Site School', status: 'active' },
};
const HOSTS = { 'mun.example.test': TENANTS.alpha };

const ROLES = [
  { key: 'owner', name: { en: 'Owner', es: 'Propietario' }, rank: 0, all: true, permissions: [] },
  { key: 'high_command', name: { en: 'High Command' }, rank: 20, all: false, permissions: ['users.view', 'users.manage', 'announcements.manage'] },
  { key: 'chair', name: { en: 'Chair', es: 'Mesa' }, rank: 30, all: false, scope: 'assigned', permissions: ['committee.run', 'delegates.manage', 'grades.manage'] },
];
// A brand-new school has only the Owner role until its owner adds more.
const EXTRA_ROLES = { [tid(4)]: [] };
// Roles a school created itself (roles page), per school.
const CUSTOM_ROLES = {};
const rolesIn = (tenant) => [...(EXTRA_ROLES[tenant] ? [ROLES[0], ...EXTRA_ROLES[tenant]] : ROLES), ...(CUSTOM_ROLES[tenant] ?? [])];
const roleOf = (key) => [...ROLES, ...Object.values(EXTRA_ROLES).flat(), ...Object.values(CUSTOM_ROLES).flat()].find((r) => r.key === key);

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
seed('owner@site.test', 'Wes Website', tid(20), 'owner');
seed('chair@site.test', 'Cat Chair', tid(20), 'chair');
seed('chair@grades.test', 'Gil Grader', tid(19), 'chair');
seed('chair2@grades.test', 'Gus Grader', tid(19), 'chair');

// Published settings per tenant. Delta is a Spanish-language school with a stricter password rule
// and one broken stored value, which must fall back to its default instead of breaking the page.
const CONFIG = {
  // The home page: a banner with dates and venue, committees under categories.
  [tid(17)]: {
    identity: { version: 1, schema_version: 1, data: { tagline: { en: 'Diplomacy in action' }, dates: { en: 'March 12–14, 2027' }, venue: { en: 'City Hall' } } },
    // The classic layout, with one announcement.
    site: {
      version: 1,
      schema_version: 1,
      data: {
        page: {
          header: { mark: 'initials', initials: '', tagline: true, userName: true },
          nav: ['home', 'dashboard', 'committees', 'people', 'grades', 'admin', 'owner', 'settings'].map((key) => ({ key, visible: ['home', 'dashboard', 'admin', 'owner'].includes(key), label: {} })),
          links: [],
          home: ['banner', 'announcements', 'welcome', 'myCommittees', 'committees'].map((kind) => ({ key: kind.toLowerCase(), kind, visible: true, title: {}, body: {}, links: [] })),
          announcements: [{ key: 'opening', message: { en: 'Opening ceremony starts at 9:00 in the main hall.' }, tone: 'info', startsAt: null, endsAt: null, onHome: true, onConsole: true }],
          admin: { title: {}, subtitle: {} },
        },
      },
    },
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
      .map((m) => ({ user_id: m.user_id, email: users.get(m.user_id).email, full_name: users.get(m.user_id).full_name, role_key: m.role_key, role_name: roleOf(m.role_key).name, rank: roleOf(m.role_key).rank, status: m.status, password_set: users.get(m.user_id).password_set, me: m.user_id === userId }))
      .sort((a, b) => a.rank - b.rank || a.email.localeCompare(b.email));
    const roles = rolesIn(p_tenant).filter((r) => r.rank >= roleOf(mine.role_key).rank).map((r) => ({ key: r.key, name: r.name, rank: r.rank }));
    return { body: { members, roles, my_rank: roleOf(mine.role_key).rank } };
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
const seesDelegates = (userId, c) => manages(userId, c.tenant_id) || (isChairOf(userId, c.id) && (can(userId, c.tenant_id, 'committee.run') || can(userId, c.tenant_id, 'delegates.manage') || can(userId, c.tenant_id, 'grades.manage')));
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

// Site School: one committee, for the website editor.
{
  const conf = { id: randomUUID(), tenant_id: tid(20), name: 'Site MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9300-000000000001', tenant_id: tid(20), conference_id: conf.id, name: 'Human Rights Council', abbreviation: 'HRC', topic: 'Digital privacy', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@site.test').id });
  for (const label of ['Brazil', 'China']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
}

// --- People (Phase 9): roles, members, audit log, provider sign-in. ---
// People School: an owner, High Command, a chair of one committee, and two people waiting on
// their invitation (one will sign in with Google).
TENANTS.people = { kind: 'tenant', id: tid(21), slug: 'people', name: 'People School', status: 'active' };
seed('owner@people.test', 'Pat People', tid(21), 'owner');
seed('hc@people.test', 'Hal Command', tid(21), 'high_command');
seed('helper@people.test', 'Hana Helper', tid(21), 'chair');
seed('leaver@people.test', 'Lee Leaver', tid(21), 'chair');
{
  const gina = addUser('gina@people.test', null, 'Gina Google', false);
  memberships.push({ tenant_id: tid(21), user_id: gina.id, role_key: 'chair', status: 'invited' });
  addUser('mike@people.test', null, 'Mike Microsoft', false);
  const conf = { id: randomUUID(), tenant_id: tid(21), name: 'People MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9400-000000000001', tenant_id: tid(21), conference_id: conf.id, name: 'Legal Committee', abbreviation: 'LEGAL', topic: 'Space law', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('helper@people.test').id });
  for (const label of ['Brazil', 'China']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
}
const auditLog = []; // { id, tenant_id, actor_id, action, target, meta, created_at }
// The impersonation header of the request being handled (handlers run one at a time).
let requestImpersonation = null;
const impersonations = []; // { id, admin_id, tenant_id, target_user_id, reason, started_at, expires_at, handoff_hash, handoff_expires_at, claimed_at, ended_at, ended_why }
const impersonatorFor = (actor) => {
  const i = impersonations.find((x) => x.id === requestImpersonation);
  return i && i.target_user_id === actor && !i.ended_at && Date.parse(i.expires_at) > Date.now() ? i.admin_id : null;
};
const audit = (tenant, actor, action, target, meta = {}) => auditLog.push({ id: auditLog.length + 1, tenant_id: tenant, actor_id: actor, impersonator_id: impersonatorFor(actor), action, target, meta, created_at: new Date().toISOString() });
const myRole = (userId, tenant) => roleOf(memberOf(userId, tenant)?.role_key);
Object.assign(rpcs, {
  roles_matrix: ({ p_tenant }, userId) => {
    const me = myRole(userId, p_tenant);
    if (!me) return { body: null };
    return {
      body: {
        my_rank: me.rank,
        roles: rolesIn(p_tenant)
          .sort((a, b) => a.rank - b.rank)
          .map((r) => ({ key: r.key, name: r.name, rank: r.rank, scope: r.scope ?? 'tenant', all_permissions: r.all, permissions: r.permissions, members: can(userId, p_tenant, 'users.view') ? memberships.filter((m) => m.tenant_id === p_tenant && m.role_key === r.key).length : null })),
      },
    };
  },
  role_save: ({ p_tenant, p_data }, userId) => {
    const me = myRole(userId, p_tenant);
    if (!me || !can(userId, p_tenant, 'roles.manage')) return DENIED;
    if (p_data.key === 'owner') return { status: 403, body: { code: '42501', message: 'The owner role cannot be changed or removed' } };
    if (p_data.rank < me.rank) return { status: 403, body: { code: '42501', message: 'You cannot create or raise a role above your own' } };
    if (!me.all && p_data.permissions.some((x) => !me.permissions.includes(x))) return { status: 403, body: { code: '42501', message: 'You cannot grant a permission you do not hold' } };
    const list = (CUSTOM_ROLES[p_tenant] ??= []);
    let r = list.find((x) => x.key === p_data.key);
    if (!r) list.push((r = { key: p_data.key, all: false }));
    Object.assign(r, { name: p_data.name, rank: p_data.rank, scope: p_data.scope, permissions: [...p_data.permissions] });
    audit(p_tenant, userId, 'roles.insert', r.key, { rank: r.rank, scope: r.scope });
    return { body: { key: r.key, rank: r.rank, scope: r.scope, permissions: r.permissions } };
  },
  role_delete: ({ p_tenant, p_key }, userId) => {
    if (!can(userId, p_tenant, 'roles.manage')) return DENIED;
    if (memberships.some((m) => m.tenant_id === p_tenant && m.role_key === p_key)) return { body: false };
    const list = CUSTOM_ROLES[p_tenant] ?? [];
    const i = list.findIndex((x) => x.key === p_key);
    if (i < 0) return { body: false };
    list.splice(i, 1);
    audit(p_tenant, userId, 'roles.delete', p_key);
    return { body: true };
  },
  member_update: ({ p_tenant, p_user, p_role, p_status }, userId) => {
    const me = myRole(userId, p_tenant);
    if (!me || !can(userId, p_tenant, 'users.manage')) return DENIED;
    if (p_user === userId) return { status: 403, body: { code: '42501', message: 'You cannot change your own membership' } };
    const m = memberships.find((x) => x.tenant_id === p_tenant && x.user_id === p_user);
    if (!m) return { body: null };
    if (roleOf(m.role_key).rank < me.rank) return { status: 403, body: { code: '42501', message: 'You cannot change someone senior to you' } };
    if (p_role && roleOf(p_role).rank < me.rank) return { status: 403, body: { code: '42501', message: 'You cannot grant a role senior to your own' } };
    if (p_role) m.role_key = p_role;
    if (p_status) m.status = p_status === 'active' && !users.get(p_user).password_set && !users.get(p_user).provider ? 'invited' : p_status;
    audit(p_tenant, userId, 'memberships.update', p_user, { role_key: m.role_key, status: m.status });
    return { body: { user_id: m.user_id, role_key: m.role_key, status: m.status } };
  },
  member_remove: ({ p_tenant, p_user }, userId) => {
    const me = myRole(userId, p_tenant);
    if (!me || !can(userId, p_tenant, 'users.manage') || p_user === userId) return DENIED;
    const i = memberships.findIndex((x) => x.tenant_id === p_tenant && x.user_id === p_user);
    if (i < 0 || roleOf(memberships[i].role_key).rank < me.rank) return { body: false };
    memberships.splice(i, 1);
    audit(p_tenant, userId, 'memberships.delete', p_user);
    return { body: true };
  },
  audit_list: ({ p_tenant, p_action }, userId) => {
    if (!can(userId, p_tenant, 'audit.view')) return { body: null };
    const mine = auditLog.filter((a) => a.tenant_id === p_tenant);
    const name = (id) => (id && users.get(id) && memberships.some((m) => m.tenant_id === p_tenant && m.user_id === id) ? nameOf(id) : null);
    return {
      body: {
        entries: mine.filter((a) => !p_action || a.action.startsWith(p_action)).reverse().slice(0, 50).map((a) => ({ ...without(a, 'impersonator_id'), actor_name: name(a.actor_id), target_name: name(a.target), impersonated: !!a.impersonator_id })),
        actions: [...new Set(mine.map((a) => a.action.split('.')[0]))],
      },
    };
  },
  announcements_publish: ({ p_tenant, p_items }, userId) => {
    if (!can(userId, p_tenant, 'announcements.manage') && !can(userId, p_tenant, 'tenant.manage')) return { status: 403, body: { code: '42501', message: 'You cannot post announcements here' } };
    if (!Array.isArray(p_items) || p_items.length > 20) return { status: 400, body: { code: '22023', message: 'invalid announcements' } };
    return { body: append(sectionOf(p_tenant, 'announcements'), { data: { items: p_items }, schema_version: 1 }, 'announcements', null, userId) };
  },
  activate_invitations: ({ p_user }) => {
    const u = users.get(p_user);
    if (!u) return { body: null };
    u.provider = true;
    const pending = memberships.filter((m) => m.user_id === p_user && m.status === 'invited');
    pending.forEach((m) => (m.status = 'active'));
    return { body: { user_id: p_user, activated: pending.length } };
  },
});
// The provider sign-in: "Google" signs in as Gina, "Microsoft" (azure) as Mike, who was never
// invited. Codes are bound to the PKCE challenge, as the real service does.
const oauthCodes = new Map(); // code -> { userId, challenge, provider }
const OAUTH_USERS = { google: 'gina@people.test', azure: 'mike@people.test' };

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
  return !!role && (role.all || (role.permissions.includes('grades.manage') && (isChairOf(userId, c.id) || role.scope !== 'assigned')));
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

// --- Conferences and history (Phase 10, part 1). ---
// History School: last year's conference with a committee, two delegations, a closed session, a
// vote and a grade. Fresh School: nothing yet, to import into.
TENANTS.history = { kind: 'tenant', id: tid(22), slug: 'history', name: 'History School', status: 'active' };
TENANTS.fresh = { kind: 'tenant', id: tid(23), slug: 'fresh', name: 'Fresh School', status: 'active' };
seed('owner@history.test', 'Hilda History', tid(22), 'owner');
seed('chair@history.test', 'Hugo History', tid(22), 'chair');
seed('owner@fresh.test', 'Fiona Fresh', tid(23), 'owner');
{
  const conf = { id: randomUUID(), tenant_id: tid(22), name: 'MUN 2026', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date(Date.now() - 86400000).toISOString() };
  conferences.push(conf);
  const c = { id: randomUUID(), tenant_id: tid(22), conference_id: conf.id, name: 'Human Rights Council', abbreviation: 'HRC', topic: 'Digital privacy', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@history.test').id });
  const ds = ['Brazil', 'Kenya'].map((label) => ({ id: randomUUID(), committee_id: c.id, label, name: `${label} Student`, group_key: null, flag: null, extra: {}, created_at: conf.created_at }));
  delegates.push(...ds);
  const session = { id: randomUUID(), committee_id: c.id, number: 1, protocol: {}, opened_at: conf.created_at, closed_at: conf.created_at };
  liveSessions.push(session);
  voteLog.push({ session_id: session.id, id: randomUUID(), title: 'Resolution 1', subject: { kind: 'motion' }, method: 'roll_call', procedural: false, tally: { yes: 2 }, needed: 2, passed: true, vetoed: false, closed_at: conf.created_at, ballots: ds.map((d) => ({ delegate_id: d.id, label: d.label, choice: 'yes' })) });
  grades.push({ id: randomUUID(), committee_id: c.id, session_id: session.id, delegate_id: ds[0].id, label: 'Brazil', category: 'speech', category_name: { en: 'Speech' }, level: 'good', level_label: { en: 'Good' }, points: 4, weight: 1, note: '', graded_at: conf.created_at, graded_by: byEmail('chair@history.test').id });
}
const confManager = (userId, tenant) => can(userId, tenant, 'conference.manage');
const scheduleItems = []; // { id, conference_id, starts_at, ends_at, title, kind, location, session_number }
// Ops School: one committee with three delegations in an open session, for analytics, the
// schedule, modules and reset.
TENANTS.ops = { kind: 'tenant', id: tid(24), slug: 'ops', name: 'Ops School', status: 'active' };
seed('owner@ops.test', 'Olga Ops', tid(24), 'owner');
seed('hc@ops.test', 'Hank Ops', tid(24), 'high_command');
seed('chair@ops.test', 'Cora Ops', tid(24), 'chair');
{
  const conf = { id: randomUUID(), tenant_id: tid(24), name: 'Ops MUN 2026', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date(Date.now() - 86400000).toISOString() };
  conferences.push(conf);
  const c = { id: '00000000-0000-4000-9500-000000000001', tenant_id: tid(24), conference_id: conf.id, name: 'Security Council', abbreviation: 'SC', topic: 'Space debris', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  committees.push(c);
  chairs.push({ committee_id: c.id, user_id: byEmail('chair@ops.test').id });
  for (const label of ['Brazil', 'China', 'France']) delegates.push({ id: randomUUID(), committee_id: c.id, label, name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
  const session = { id: randomUUID(), committee_id: c.id, number: 1, protocol: {}, opened_at: conf.created_at, closed_at: conf.created_at };
  liveSessions.push(session);
  speechLog.push({ session_id: session.id, label: 'Brazil', list: 'general', seconds: 90, started_at: conf.created_at });
  voteLog.push({ session_id: session.id, id: randomUUID(), title: 'Motion', subject: { kind: 'motion' }, method: 'placard', procedural: true, tally: { yes: 3 }, needed: 2, passed: true, vetoed: false, closed_at: conf.created_at, ballots: null });
}
const committeesOf = (conferenceId) => committees.filter((c) => c.conference_id === conferenceId);
const sessionsOf = (cid) => liveSessions.filter((x) => x.committee_id === cid);
const confCounts = (f) => {
  const cs = committeesOf(f.id).map((c) => c.id);
  const ss = liveSessions.filter((x) => cs.includes(x.committee_id)).map((x) => x.id);
  const vs = voteLog.filter((v) => ss.includes(v.session_id));
  const sp = speechLog.filter((x) => ss.includes(x.session_id));
  return { committees: cs.length, delegates: delegates.filter((d) => cs.includes(d.committee_id)).length, sessions: ss.length, votes: vs.length, passed: vs.filter((v) => v.passed).length, speeches: sp.length, speaking_seconds: sp.reduce((n, x) => n + x.seconds, 0), documents: documents.filter((d) => cs.includes(d.committee_id)).length, warnings: warningLog.filter((w) => cs.includes(w.committee_id)).length, grades: grades.filter((g) => cs.includes(g.committee_id)).length };
};
// What an export holds, per kind of record (the same tables as the database's export).
const schoolExport = (tenant) => {
  const confs = conferences.filter((f) => f.tenant_id === tenant);
  const cs = committees.filter((c) => c.tenant_id === tenant);
  const ids = cs.map((c) => c.id);
  const ss = liveSessions.filter((x) => ids.includes(x.committee_id));
  const sids = ss.map((x) => x.id);
  return {
    format: 'sessional-export', version: 1, exported_at: new Date().toISOString(), tenant: Object.values(TENANTS).find((x) => x.id === tenant),
    settings: Object.fromEntries(Object.entries(CONFIG[tenant] ?? {}).map(([k, v]) => [k, { schema_version: 1, data: v.data }])),
    roles: (CUSTOM_ROLES[tenant] ?? []).map((r) => ({ key: r.key, name: r.name, rank: r.rank, scope: r.scope, permissions: r.permissions })),
    conferences: confs.map((f) => without(f, 'tenant_id')), committees: cs.map((c) => without(c, 'tenant_id')), committee_secrets: [],
    delegates: delegates.filter((d) => ids.includes(d.committee_id)), sessions: ss, roll_calls: rollCalls.filter((r) => sids.includes(r.session_id)),
    speeches: speechLog.filter((x) => sids.includes(x.session_id)), votes: voteLog.filter((v) => sids.includes(v.session_id)), warnings: warningLog.filter((w) => ids.includes(w.committee_id)),
    documents: documents.filter((d) => ids.includes(d.committee_id)), grades: grades.filter((g) => ids.includes(g.committee_id)).map((g) => without(g, 'graded_by')), awards: awardRows.filter((a) => ids.includes(a.committee_id)),
    export_mappings: mappings.filter((m) => m.tenant_id === tenant).map((m) => without(m, 'tenant_id')),
    schedule_items: scheduleItems.filter((x) => confs.some((f) => f.id === x.conference_id)),
  };
};
const EXPORT_KEYS = ['roles', 'conferences', 'committees', 'committee_secrets', 'delegates', 'sessions', 'roll_calls', 'speeches', 'votes', 'warnings', 'documents', 'grades', 'awards', 'export_mappings', 'schedule_items'];
const without = (row, ...keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
const countsOfExport = (data) => Object.fromEntries(EXPORT_KEYS.map((k) => [k, Array.isArray(data[k]) ? data[k].length : 0]));
Object.assign(rpcs, {
  schedule_list: ({ p_conference }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    return { body: f && memberOf(userId, f.tenant_id) ? scheduleItems.filter((x) => x.conference_id === f.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at)) : [] };
  },
  schedule_save: ({ p_conference, p_data }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !confManager(userId, f.tenant_id)) return DENIED;
    const row = { id: randomUUID(), conference_id: f.id, starts_at: p_data.starts_at, ends_at: p_data.ends_at, title: p_data.title, kind: p_data.kind, location: p_data.location ?? '', session_number: p_data.session_number ? Number(p_data.session_number) : null };
    scheduleItems.push(row);
    return { body: row };
  },
  schedule_delete: ({ p_item }, userId) => {
    const i = scheduleItems.findIndex((x) => x.id === p_item);
    const f = i >= 0 ? conferences.find((x) => x.id === scheduleItems[i].conference_id) : null;
    if (!f || !confManager(userId, f.tenant_id)) return { body: false };
    scheduleItems.splice(i, 1);
    return { body: true };
  },
  conference_analytics: ({ p_tenant }, userId) => {
    if (!['conference.manage', 'committee.manage', 'grades.view'].some((p) => can(userId, p_tenant, p))) return { body: null };
    const f = activeConference(p_tenant);
    if (!f) return { body: { conference: null, committees: [], at: new Date().toISOString() } };
    return {
      body: {
        conference: { id: f.id, name: f.name },
        at: new Date().toISOString(),
        committees: committeesOf(f.id).map((c) => {
          const ss = sessionsOf(c.id).map((x) => x.id);
          const vs = voteLog.filter((v) => ss.includes(v.session_id));
          const sp = speechLog.filter((x) => ss.includes(x.session_id));
          const open = sessionsOf(c.id).find((x) => !x.closed_at);
          const att = live.get(c.id)?.state?.attendance ?? {};
          return {
            id: c.id, name: c.name, abbreviation: c.abbreviation, sort_order: c.sort_order,
            status: { status: open ? 'in_session' : ss.length ? 'between_sessions' : 'not_started', session_number: open?.number ?? null, mode: null },
            members: delegates.filter((d) => d.committee_id === c.id).length,
            present: open ? Object.values(att).filter((v) => v !== 'absent').length : 0,
            sessions: ss.length, speeches: sp.length, speaking_seconds: sp.reduce((n, x) => n + x.seconds, 0), motions: 0, points: 0,
            votes: vs.length, passed: vs.filter((v) => v.passed).length, warnings: warningLog.filter((w) => w.committee_id === c.id).length,
            documents: documents.filter((d) => d.committee_id === c.id).length,
            grades: can(userId, p_tenant, 'grades.view') ? grades.filter((g) => g.committee_id === c.id).length : null,
            last_activity: f.created_at,
          };
        }),
      },
    };
  },
  tenant_reset: ({ p_tenant, p_confirm }, userId) => {
    if (!roleOf(memberOf(userId, p_tenant)?.role_key)?.all) return { status: 403, body: { code: '42501', message: 'Only the Owner can reset the school' } };
    const t = Object.values(TENANTS).find((x) => x.id === p_tenant);
    if (p_confirm !== t?.name) return { status: 400, body: { code: '22023', message: "Type the school's name to confirm" } };
    for (let i = conferences.length - 1; i >= 0; i--) if (conferences[i].tenant_id === p_tenant) conferences.splice(i, 1);
    for (let i = committees.length - 1; i >= 0; i--) if (committees[i].tenant_id === p_tenant) committees.splice(i, 1);
    return { body: countsOfExport(schoolExport(p_tenant)) };
  },
  conferences_list: ({ p_tenant }, userId) => ({ body: memberOf(userId, p_tenant) ? conferences.filter((f) => f.tenant_id === p_tenant).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((f) => ({ id: f.id, name: f.name, status: f.status, created_at: f.created_at, ...confCounts(f) })) : [] }),
  conference_summary: ({ p_conference }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !memberOf(userId, f.tenant_id)) return { body: null };
    return {
      body: {
        conference: f,
        committees: committeesOf(f.id).map((c) => {
          const ss = sessionsOf(c.id).map((x) => x.id);
          const vs = voteLog.filter((v) => ss.includes(v.session_id));
          return { id: c.id, name: c.name, abbreviation: c.abbreviation, topic: c.topic, delegates: delegates.filter((d) => d.committee_id === c.id).length, sessions: ss.length, speeches: speechLog.filter((x) => ss.includes(x.session_id)).length, votes: vs.length, passed: vs.filter((v) => v.passed).length, grades: grades.filter((g) => g.committee_id === c.id).length, awards: can(userId, f.tenant_id, 'grades.view') ? awardRows.filter((a) => a.committee_id === c.id) : [] };
        }),
      },
    };
  },
  conference_clone: ({ p_source, p_name, p_options }, userId) => {
    const src = conferences.find((x) => x.id === p_source);
    if (!src || !confManager(userId, src.tenant_id) || !manages(userId, src.tenant_id)) return DENIED;
    const f = { id: randomUUID(), tenant_id: src.tenant_id, name: p_name, status: 'draft', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() };
    conferences.push(f);
    for (const c of committeesOf(src.id)) {
      const copy = { ...c, id: randomUUID(), conference_id: f.id, topic: p_options.topics === false ? '' : c.topic, created_at: f.created_at };
      committees.push(copy);
      if (p_options.delegates !== false) delegates.push(...delegates.filter((d) => d.committee_id === c.id).map((d) => ({ ...d, id: randomUUID(), committee_id: copy.id, name: '' })));
      if (p_options.chairs) chairs.push(...chairs.filter((x) => x.committee_id === c.id).map((x) => ({ ...x, committee_id: copy.id })));
    }
    if (p_options.schedule_days != null) scheduleItems.push(...scheduleItems.filter((x) => x.conference_id === src.id).map((x) => ({ ...x, id: randomUUID(), conference_id: f.id, starts_at: new Date(Date.parse(x.starts_at) + p_options.schedule_days * 86400000).toISOString(), ends_at: new Date(Date.parse(x.ends_at) + p_options.schedule_days * 86400000).toISOString() })));
    if (p_options.make_current) {
      conferences.filter((x) => x.tenant_id === f.tenant_id && x.status === 'active').forEach((x) => (x.status = 'archived'));
      f.status = 'active';
    }
    return { body: { id: f.id, name: f.name, status: f.status, ...confCounts(f) } };
  },
  conference_activate: ({ p_conference }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !confManager(userId, f.tenant_id)) return { body: null };
    conferences.filter((x) => x.tenant_id === f.tenant_id && x.status === 'active').forEach((x) => (x.status = 'archived'));
    f.status = 'active';
    return { body: f };
  },
  conference_set_status: ({ p_conference, p_status }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !confManager(userId, f.tenant_id)) return { body: null };
    f.status = p_status;
    return { body: f };
  },
  conference_rename: ({ p_conference, p_name }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f || !confManager(userId, f.tenant_id)) return { body: null };
    f.name = p_name;
    return { body: f };
  },
  tenant_export: ({ p_tenant }, userId) => ({ body: can(userId, p_tenant, 'tenant.manage') ? schoolExport(p_tenant) : null }),
  tenant_counts: ({ p_tenant }, userId) => ({ body: can(userId, p_tenant, 'tenant.manage') ? countsOfExport(schoolExport(p_tenant)) : null }),
  tenant_import: ({ p_tenant, p_data }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return { status: 403, body: { code: '42501', message: 'You cannot import into this school' } };
    if (p_data?.format !== 'sessional-export' || p_data.version !== 1) return { status: 400, body: { code: '22023', message: 'not a Sessional export' } };
    if (conferences.some((f) => f.tenant_id === p_tenant)) return { status: 400, body: { code: '22023', message: 'This school already has conferences: import only into an empty school' } };
    const map = new Map();
    const id = (old) => (old ? (map.get(old) ?? (map.set(old, randomUUID()), map.get(old))) : null);
    for (const f of p_data.conferences) conferences.push({ ...f, id: id(f.id), tenant_id: p_tenant });
    for (const c of p_data.committees) committees.push({ ...c, id: id(c.id), conference_id: id(c.conference_id), tenant_id: p_tenant });
    for (const d of p_data.delegates) delegates.push({ ...d, id: id(d.id), committee_id: id(d.committee_id) });
    for (const x of p_data.sessions) liveSessions.push({ ...x, id: id(x.id), committee_id: id(x.committee_id) });
    for (const r of p_data.roll_calls) rollCalls.push({ ...r, id: id(r.id), session_id: id(r.session_id) });
    for (const x of p_data.speeches) speechLog.push({ ...x, session_id: id(x.session_id), delegate_id: id(x.delegate_id) });
    for (const v of p_data.votes) voteLog.push({ ...v, id: id(v.id), session_id: id(v.session_id), ballots: v.ballots?.map((b) => ({ ...b, delegate_id: id(b.delegate_id) })) ?? null });
    for (const w of p_data.warnings) warningLog.push({ ...w, committee_id: id(w.committee_id) });
    for (const d of p_data.documents) documents.push({ ...d, id: id(d.id), committee_id: id(d.committee_id) });
    for (const g of p_data.grades) grades.push({ ...g, id: id(g.id), committee_id: id(g.committee_id), session_id: id(g.session_id), delegate_id: id(g.delegate_id) });
    for (const a of p_data.awards) awardRows.push({ ...a, committee_id: id(a.committee_id), delegate_id: id(a.delegate_id) });
    for (const m of p_data.export_mappings) mappings.push({ ...m, id: id(m.id), tenant_id: p_tenant });
    for (const r of p_data.roles) (CUSTOM_ROLES[p_tenant] ??= []).push({ ...r, all: false });
    for (const x of p_data.schedule_items ?? []) scheduleItems.push({ ...x, id: id(x.id), conference_id: id(x.conference_id) });
    return { body: countsOfExport(schoolExport(p_tenant)) };
  },
});

// --- Phase 11: imports (undo removes exactly what they added) and the public read. ---
// Pub School: one committee with two delegations (one with a student's name), a passed
// resolution, a confidential crisis committee and a schedule item.
TENANTS.pub = { kind: 'tenant', id: tid(25), slug: 'pub', name: 'Pub School', status: 'active' };
// A crisis committee type whose topic is confidential.
CONFIG[tid(25)] = {
  structure: { version: 1, schema_version: 1, data: { categories: [], types: [
    { key: 'standard', name: { en: 'Standard' }, labelField: { en: 'Country' }, defaultCategory: null, flag: 'country', groupLabel: {}, groups: [], groupRequired: false, confidentialTopic: false, veto: false, fields: [], bulk: ['label', 'name'] },
    { key: 'crisis', name: { en: 'Crisis' }, labelField: { en: 'Role' }, defaultCategory: null, flag: 'none', groupLabel: {}, groups: [], groupRequired: false, confidentialTopic: true, veto: false, fields: [], bulk: ['label', 'name'] },
  ] } },
};
seed('owner@pub.test', 'Pia Pub', tid(25), 'owner');
seed('hc@pub.test', 'Hal Pub', tid(25), 'high_command');
seed('chair@pub.test', 'Cy Pub', tid(25), 'chair');
{
  const conf = { id: randomUUID(), tenant_id: tid(25), name: 'Pub MUN 2026', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date(Date.now() - 86400000).toISOString() };
  conferences.push(conf);
  const sc = { id: '00000000-0000-4000-9600-000000000001', tenant_id: tid(25), conference_id: conf.id, name: 'Security Council', abbreviation: 'SC', topic: 'Space debris', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: conf.created_at };
  const cr = { id: '00000000-0000-4000-9600-000000000002', tenant_id: tid(25), conference_id: conf.id, name: 'Crisis Cabinet', abbreviation: 'CC', topic: 'Secret plot', description: '', category_key: null, type_key: 'crisis', language: null, sort_order: 1, created_at: conf.created_at };
  committees.push(sc, cr);
  chairs.push({ committee_id: sc.id, user_id: byEmail('chair@pub.test').id });
  delegates.push({ id: '00000000-0000-4000-9600-0000000000d1', committee_id: sc.id, label: 'Brazil', name: 'Bea Student', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
  delegates.push({ id: '00000000-0000-4000-9600-0000000000d2', committee_id: sc.id, label: 'Kenya', name: '', group_key: null, flag: null, extra: {}, created_at: conf.created_at });
  documents.push({ id: randomUUID(), committee_id: sc.id, kind: 'resolution', code: 'SC/1', title: 'On orbital clean-up', body: 'Operative clause one.', parent_id: null, sponsors: [], signatories: [], status: 'passed', created_at: conf.created_at });
  documents.push({ id: randomUUID(), committee_id: sc.id, kind: 'resolution', code: 'SC/2', title: 'Unfinished draft', body: '', parent_id: null, sponsors: [], signatories: [], status: 'draft', created_at: conf.created_at });
  const start = new Date(Date.now() + 3600000);
  scheduleItems.push({ id: randomUUID(), conference_id: conf.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600000).toISOString(), title: 'Opening ceremony', kind: 'ceremony', location: 'Main hall', session_number: null });
}
const importBatches = []; // { id, tenant_id, conference_id, source, file_name, rows_total, rows_imported, committees_created, created_by, created_at, undone_at }
Object.assign(rpcs, {
  import_apply: ({ p_conference, p_rows, p_meta }, userId) => {
    const f = conferences.find((x) => x.id === p_conference);
    if (!f) return { body: null };
    if (!manages(userId, f.tenant_id)) return DENIED;
    if (!Array.isArray(p_rows) || p_rows.length > 2000) return { status: 400, body: { code: '22023', message: 'invalid rows' } };
    if (p_rows.some((r) => !String(r.label ?? '').trim() || (r.committee.id && !committees.some((c) => c.id === r.committee.id && c.conference_id === f.id)))) return { status: 400, body: { code: '22023', message: 'invalid row' } };
    const batch = { id: randomUUID(), tenant_id: f.tenant_id, conference_id: f.id, source: p_meta.source ?? 'csv', file_name: p_meta.file_name ?? '', rows_total: p_meta.rows_total ?? p_rows.length, rows_imported: 0, committees_created: 0, created_by: userId, created_at: new Date().toISOString(), undone_at: null };
    importBatches.push(batch);
    const made = new Map();
    let order = Math.max(0, ...committeesOf(f.id).map((c) => c.sort_order));
    for (const r of p_rows) {
      let cid = r.committee.id;
      if (!cid) {
        const k = r.committee.name.trim().toLowerCase();
        if (!made.has(k)) {
          const c = { id: randomUUID(), tenant_id: f.tenant_id, conference_id: f.id, name: r.committee.name.trim(), abbreviation: r.committee.abbreviation ?? '', topic: '', description: '', category_key: null, type_key: r.committee.type_key ?? 'standard', language: null, sort_order: ++order, created_at: new Date().toISOString(), import_batch_id: batch.id };
          committees.push(c);
          made.set(k, c.id);
          batch.committees_created++;
        }
        cid = made.get(k);
      }
      delegates.push({ id: randomUUID(), committee_id: cid, label: r.label.trim(), name: String(r.name ?? '').slice(0, 160), group_key: r.group_key || null, flag: null, extra: {}, created_at: new Date().toISOString(), import_batch_id: batch.id });
      batch.rows_imported++;
    }
    audit(f.tenant_id, userId, 'import_batches.insert', batch.id);
    return { body: { batch: batch.id, imported: batch.rows_imported, committees_created: batch.committees_created } };
  },
  import_undo: ({ p_batch }, userId) => {
    const b = importBatches.find((x) => x.id === p_batch);
    if (!b || !manages(userId, b.tenant_id)) return { body: null };
    if (b.undone_at) return { status: 400, body: { code: '22023', message: 'already undone' } };
    const gone = delegates.filter((d) => d.import_batch_id === b.id);
    for (const d of gone) delegates.splice(delegates.indexOf(d), 1);
    const empty = committees.filter((c) => c.import_batch_id === b.id && !delegates.some((d) => d.committee_id === c.id));
    for (const c of empty) committees.splice(committees.indexOf(c), 1);
    b.undone_at = new Date().toISOString();
    audit(b.tenant_id, userId, 'import_batches.update', b.id);
    return { body: { delegates: gone.length, committees: empty.length } };
  },
  import_batches_list: ({ p_tenant }, userId) => ({
    body: manages(userId, p_tenant)
      ? importBatches.filter((b) => b.tenant_id === p_tenant).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((b) => ({ ...without(b, 'tenant_id', 'conference_id', 'created_by'), by: nameOf(b.created_by), remaining: delegates.filter((d) => d.import_batch_id === b.id).length }))
      : [],
  }),
  // Whitelisted fields only, as the database's public_site.
  public_site: ({ p_tenant }) => {
    const conf = activeConference(p_tenant);
    if (!conf) return { body: null };
    return {
      body: {
        conference: { name: conf.name },
        committees: committeesOf(conf.id).sort((a, b) => a.sort_order - b.sort_order).map((c) => ({
          id: c.id, name: c.name, abbreviation: c.abbreviation, topic: c.topic, category_key: c.category_key, type_key: c.type_key,
          delegations: delegates.filter((d) => d.committee_id === c.id).sort((a, b) => a.label.localeCompare(b.label)).map((d) => ({ label: d.label, flag: d.flag, group_key: d.group_key })),
          resolutions: documents.filter((d) => d.committee_id === c.id && d.status === 'passed' && !d.parent_id).map((d) => ({ code: d.code, title: d.title, kind: d.kind })),
        })),
        schedule: scheduleItems.filter((x) => x.conference_id === conf.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((x) => without(x, 'id', 'conference_id')),
      },
    };
  },
});

// --- Phase 12: the control plane. root@platform.test is a platform admin; Control School has an
// owner, a chair who has signed in, and an invited member. ---
TENANTS.ctl = { kind: 'tenant', id: tid(26), slug: 'ctl', name: 'Control School', status: 'active' };
seed('owner@ctl.test', 'Olive Control', tid(26), 'owner');
seed('chair@ctl.test', 'Chad Control', tid(26), 'chair');
memberships.push({ tenant_id: tid(26), user_id: addUser('invited@ctl.test', null, 'Ivy Invited', false).id, role_key: 'chair', status: 'invited' });
conferences.push({ id: randomUUID(), tenant_id: tid(26), name: 'Control MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() });
const platformAdmins = new Set([addUser('root@platform.test', 'correct-password', 'Root Admin').id]);
const flagGlobal = {}; // key -> { enabled, note }
const flagOverrides = []; // { tenant_id, key, enabled }
const platformAnnouncements = [];
const platformPresets = [];
// The website's contact form (contact_requests).
const contactRequests = [];
const tenantRow = (id) => Object.values(TENANTS).find((t) => t.kind === 'tenant' && t.id === id);
const NOT_ADMIN = { status: 403, body: { code: '42501', message: 'not found' } };
const invalid = (message) => ({ status: 400, body: { code: '22023', message } });
const platformAudit = (tenant, admin, action, target, meta = {}) => auditLog.push({ id: auditLog.length + 1, tenant_id: tenant, actor_id: admin, impersonator_id: admin, action, target, meta, created_at: new Date().toISOString() });
const usageOf = (tenant) => {
  const cs = committees.filter((c) => c.tenant_id === tenant).map((c) => c.id);
  const log = auditLog.filter((a) => a.tenant_id === tenant);
  return {
    members: memberships.filter((m) => m.tenant_id === tenant && m.status === 'active').length,
    invited: memberships.filter((m) => m.tenant_id === tenant && m.status === 'invited').length,
    conferences: conferences.filter((f) => f.tenant_id === tenant).length, committees: cs.length,
    delegates: delegates.filter((d) => cs.includes(d.committee_id)).length,
    sessions_30d: liveSessions.filter((x) => cs.includes(x.committee_id)).length,
    changes_30d: log.length, last_activity: log.at(-1)?.created_at ?? null,
    settings_published: Object.keys(CONFIG[tenant] ?? {}).length, domains: 0,
  };
};
const inForce = (i) => !i.ended_at && Date.parse(i.expires_at) > Date.now();
Object.assign(rpcs, {
  am_platform_admin: (_b, userId) => ({ body: platformAdmins.has(userId) }),
  platform_tenants: ({ p_query }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const q = String(p_query ?? '').toLowerCase();
    const list = Object.values(TENANTS).filter((t) => t.kind === 'tenant' && (!q || t.slug.includes(q) || t.name.toLowerCase().includes(q)));
    return { body: list.map((t) => ({ id: t.id, slug: t.slug, name: t.name, status: t.status, plan_key: null, created_at: '2026-01-01T00:00:00Z', deleted_at: t.deleted_at ?? null, purge_after: t.purge_after ?? null, usage: usageOf(t.id) })) };
  },
  platform_tenant: ({ p_tenant }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const t = tenantRow(p_tenant);
    if (!t) return { body: null };
    return {
      body: {
        id: t.id, slug: t.slug, name: t.name, status: t.status, status_before: t.status_before ?? null, plan_key: null, created_at: '2026-01-01T00:00:00Z',
        deleted_at: t.deleted_at ?? null, purge_after: t.purge_after ?? null, usage: usageOf(t.id), domains: [],
        members: memberships.filter((m) => m.tenant_id === t.id).map((m) => ({ user_id: m.user_id, email: users.get(m.user_id).email, name: users.get(m.user_id).full_name, role_key: m.role_key, status: m.status, staff: m.role_key === 'owner' })),
        flags: Object.fromEntries(flagOverrides.filter((o) => o.tenant_id === t.id).map((o) => [o.key, o.enabled])),
        impersonations: impersonations.filter((i) => i.tenant_id === t.id).reverse().map((i) => ({ id: i.id, admin: users.get(i.admin_id).email, target: nameOf(i.target_user_id), reason: i.reason, started_at: i.started_at, expires_at: i.expires_at, ended_at: i.ended_at, ended_why: i.ended_why })),
        audit: auditLog.filter((a) => a.tenant_id === t.id).reverse().slice(0, 50).map((a) => ({ action: a.action, created_at: a.created_at, by_platform: !!a.impersonator_id })),
      },
    };
  },
  platform_set_suspended: ({ p_tenant, p_suspended, p_reason }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const t = tenantRow(p_tenant);
    if (!t || t.status === 'deleted') return { body: null };
    if (String(p_reason ?? '').trim().length < 5) return invalid('a reason is needed');
    if (p_suspended && t.status !== 'suspended') Object.assign(t, { status_before: t.status, status: 'suspended' });
    else if (!p_suspended && t.status === 'suspended') Object.assign(t, { status: t.status_before ?? 'active', status_before: null });
    else return { body: { status: t.status } };
    platformAudit(t.id, userId, p_suspended ? 'platform.suspend' : 'platform.unsuspend', t.id, { reason: p_reason });
    return { body: { status: t.status } };
  },
  platform_delete: ({ p_tenant, p_confirm, p_reason }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const t = tenantRow(p_tenant);
    if (!t) return { body: null };
    if (p_confirm !== t.slug) return invalid('confirmation does not match');
    if (String(p_reason ?? '').trim().length < 5) return invalid('a reason is needed');
    Object.assign(t, { status_before: t.status === 'suspended' ? t.status_before ?? 'active' : t.status, status: 'deleted', deleted_at: new Date().toISOString(), purge_after: new Date(Date.now() + 30 * 86400000).toISOString() });
    platformAudit(t.id, userId, 'platform.delete', t.id, { reason: p_reason });
    return { body: { status: t.status, purge_after: t.purge_after } };
  },
  platform_restore: ({ p_tenant }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const t = tenantRow(p_tenant);
    if (!t || t.status !== 'deleted') return { body: null };
    Object.assign(t, { status: t.status_before ?? 'active', status_before: null, deleted_at: null, purge_after: null });
    platformAudit(t.id, userId, 'platform.restore', t.id);
    return { body: { status: t.status } };
  },
  platform_purge: (_b, userId) => (platformAdmins.has(userId) ? { body: false } : NOT_ADMIN),
  platform_impersonate_start: ({ p_tenant, p_user, p_reason, p_minutes, p_handoff_hash }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const t = tenantRow(p_tenant);
    if (!t || ['suspended', 'deleted'].includes(t.status)) return invalid('school not available');
    if (String(p_reason ?? '').trim().length < 10) return invalid('a reason of at least 10 characters is needed');
    if (!(p_minutes >= 5 && p_minutes <= 60)) return invalid('between 5 and 60 minutes');
    if (!memberOf(p_user, t.id)) return invalid('not an active member');
    for (const i of impersonations) if (i.admin_id === userId && inForce(i)) Object.assign(i, { ended_at: new Date().toISOString(), ended_why: 'replaced' });
    const i = { id: randomUUID(), admin_id: userId, tenant_id: t.id, target_user_id: p_user, reason: p_reason.trim(), started_at: new Date().toISOString(), expires_at: new Date(Date.now() + p_minutes * 60000).toISOString(), handoff_hash: p_handoff_hash, handoff_expires_at: new Date(Date.now() + 120000).toISOString(), claimed_at: null, ended_at: null, ended_why: null };
    impersonations.push(i);
    platformAudit(t.id, userId, 'impersonation.start', p_user, { reason: i.reason, minutes: p_minutes, impersonation: i.id });
    return { body: { id: i.id } };
  },
  impersonation_claim: ({ p_id, p_hash }) => {
    const i = impersonations.find((x) => x.id === p_id);
    if (!i || i.handoff_hash !== p_hash || i.claimed_at || !inForce(i) || Date.parse(i.handoff_expires_at) <= Date.now()) return { body: null };
    i.claimed_at = new Date().toISOString();
    return { body: { tenant_id: i.tenant_id, user_id: i.target_user_id, expires_at: i.expires_at, email: users.get(i.target_user_id).email } };
  },
  impersonation_status: ({ p_id }) => {
    const i = impersonations.find((x) => x.id === p_id);
    return { body: i ? { active: inForce(i), tenant_id: i.tenant_id, user_id: i.target_user_id, expires_at: i.expires_at, reason: i.reason, admin: users.get(i.admin_id).email } : null };
  },
  impersonation_end: ({ p_id, p_why }) => {
    const i = impersonations.find((x) => x.id === p_id);
    if (!i || i.ended_at) return { body: false };
    Object.assign(i, { ended_at: new Date(Math.min(Date.now(), Date.parse(i.expires_at))).toISOString(), ended_why: p_why });
    auditLog.push({ id: auditLog.length + 1, tenant_id: i.tenant_id, actor_id: i.admin_id, impersonator_id: i.admin_id, action: 'impersonation.end', target: i.target_user_id, meta: { why: p_why }, created_at: new Date().toISOString() });
    return { body: true };
  },
  platform_flags: (_b, userId) => (platformAdmins.has(userId) ? { body: { global: flagGlobal, overrides: flagOverrides.map((o) => ({ ...o, slug: tenantRow(o.tenant_id)?.slug })) } } : NOT_ADMIN),
  platform_flag_set: ({ p_key, p_enabled, p_note }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    if (p_enabled === null) delete flagGlobal[p_key];
    else flagGlobal[p_key] = { enabled: p_enabled, note: p_note ?? '' };
    return { body: true };
  },
  platform_flag_override: ({ p_tenant, p_key, p_enabled }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const i = flagOverrides.findIndex((o) => o.tenant_id === p_tenant && o.key === p_key);
    if (i >= 0) flagOverrides.splice(i, 1);
    if (p_enabled !== null) flagOverrides.push({ tenant_id: p_tenant, key: p_key, enabled: p_enabled });
    platformAudit(p_tenant, userId, 'platform.flag', p_key, { enabled: p_enabled });
    return { body: true };
  },
  feature_flags_for: ({ p_tenant }) => ({
    body: { ...Object.fromEntries(Object.entries(flagGlobal).map(([k, v]) => [k, v.enabled])), ...Object.fromEntries(flagOverrides.filter((o) => o.tenant_id === p_tenant).map((o) => [o.key, o.enabled])) },
  }),
  platform_announcements_list: (_b, userId) => (platformAdmins.has(userId) ? { body: [...platformAnnouncements].reverse() } : NOT_ADMIN),
  platform_announcement_save: ({ p_data }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const a = { id: randomUUID(), message: p_data.message, tone: p_data.tone ?? 'info', audience: p_data.audience ?? 'all', starts_at: new Date(Date.now() - 1000).toISOString(), ends_at: p_data.ends_at ?? null };
    platformAnnouncements.push(a);
    return { body: a.id };
  },
  platform_announcement_end: ({ p_id }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const a = platformAnnouncements.find((x) => x.id === p_id);
    if (!a) return { body: false };
    a.ends_at = new Date().toISOString();
    return { body: true };
  },
  platform_announcements_live: () => ({ body: platformAnnouncements.filter((a) => Date.parse(a.starts_at) <= Date.now() && (!a.ends_at || Date.parse(a.ends_at) > Date.now())) }),
  platform_presets_list: (_b, userId) => (platformAdmins.has(userId) ? { body: platformPresets.map((p) => without(p, 'data')) } : NOT_ADMIN),
  platform_preset_save: ({ p_data }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    if (!p_data.id) {
      const p = { id: randomUUID(), section: p_data.section, name: p_data.name, description: p_data.description ?? {}, data: p_data.data, schema_version: p_data.schema_version ?? 1, version: 1, published: !!p_data.published, updated_at: new Date().toISOString() };
      platformPresets.push(p);
      return { body: p.id };
    }
    const p = platformPresets.find((x) => x.id === p_data.id);
    if (!p) return { body: null };
    if ('published' in p_data) p.published = p_data.published;
    return { body: p.id };
  },
  platform_preset_delete: ({ p_id }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const i = platformPresets.findIndex((x) => x.id === p_id);
    if (i >= 0) platformPresets.splice(i, 1);
    return { body: i >= 0 };
  },
  contact_submit: ({ p_data, p_sender }) => {
    const hour = Date.now() - 3600_000;
    if (contactRequests.filter((c) => c.sender === p_sender && Date.parse(c.created_at) > hour).length >= 3) return { body: { error: 'rate' } };
    const row = { id: randomUUID(), created_at: new Date().toISOString(), ...p_data, email: String(p_data.email).toLowerCase(), sender: p_sender, emailed: false, status: 'new' };
    for (const k of ['country', 'conference', 'month', 'message']) if (row[k] === '') row[k] = null;
    contactRequests.push(row);
    return { body: { id: row.id } };
  },
  contact_mark_emailed: ({ p_id }) => {
    const c = contactRequests.find((x) => x.id === p_id);
    if (c) c.emailed = true;
    return { body: !!c };
  },
  platform_contact_list: (_b, userId) => (platformAdmins.has(userId) ? { body: [...contactRequests].reverse().map((c) => without(c, 'sender')) } : NOT_ADMIN),
  platform_contact_set: ({ p_id, p_status }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const c = contactRequests.find((x) => x.id === p_id);
    if (c) c.status = p_status;
    return { body: !!c };
  },
  platform_contact_delete: ({ p_id }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const i = contactRequests.findIndex((x) => x.id === p_id);
    if (i >= 0) contactRequests.splice(i, 1);
    return { body: i >= 0 };
  },
  presets_published: ({ p_section }) => ({ body: platformPresets.filter((p) => p.section === p_section && p.published).map((p) => without(p, 'published', 'section', 'updated_at')) }),
  platform_find_person: ({ p_email }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const u = byEmail(String(p_email).trim().toLowerCase());
    if (!u) return { body: null };
    return { body: { user_id: u.id, email: u.email, name: u.full_name, created_at: '2026-01-01T00:00:00Z', platform_admin: platformAdmins.has(u.id), schools: memberships.filter((m) => m.user_id === u.id).map((m) => ({ tenant_id: m.tenant_id, slug: tenantRow(m.tenant_id)?.slug, name: tenantRow(m.tenant_id)?.name, tenant_status: tenantRow(m.tenant_id)?.status, role_key: m.role_key, status: m.status })) } };
  },
  platform_diagnostics: ({ p_tenant }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const t = tenantRow(p_tenant);
    if (!t) return { body: null };
    return { body: { tenant: { id: t.id, slug: t.slug, status: t.status }, usage: usageOf(t.id), settings: [], domains: [], roles: [], flags: {}, conferences: [], audit: auditLog.filter((a) => a.tenant_id === t.id).map((a) => ({ action: a.action, created_at: a.created_at, by_platform: !!a.impersonator_id })) } };
  },
});

// --- Phase 13: billing. Bill School has an owner and High Command; plans carry Stripe price ids;
// a stand-in for Stripe answers under /stripe and sends signed webhooks back to the app. ---
TENANTS.bill = { kind: 'tenant', id: tid(27), slug: 'bill', name: 'Bill School', status: 'active' };
seed('owner@bill.test', 'Bea Bill', tid(27), 'owner');
seed('hc@bill.test', 'Hugh Bill', tid(27), 'high_command');
conferences.push({ id: randomUUID(), tenant_id: tid(27), name: 'Bill MUN', status: 'active', secrets_unlocked_at: null, secrets_unlock_rule: 'manual', created_at: new Date().toISOString() });
committees.push({ id: randomUUID(), tenant_id: tid(27), conference_id: conferences.at(-1).id, name: 'General Assembly', abbreviation: 'GA', topic: '', description: '', category_key: null, type_key: 'standard', language: null, sort_order: 0, created_at: new Date().toISOString() });
const priceId = (plan, key) => `price_${plan}_${key}`;
const PLANS = [
  { key: 'starter', name: { en: 'Starter', es: 'Inicial' }, description: { en: 'A class or club simulation.' }, limits: { committees: 6, delegates: 150, staff: 10, active_conferences: 1, storage_mb: 1024 }, features: {}, per_school: false, public: true, sort: 1,
    prices: [{ key: 'month_usd', interval: 'month', currency: 'usd', amount: 1900 }, { key: 'month_mxn', interval: 'month', currency: 'mxn', amount: 34900 }] },
  { key: 'conference', name: { en: 'Conference', es: 'Conferencia' }, description: { en: 'One real conference.' }, limits: { committees: 25, delegates: 750, staff: 60, active_conferences: 1, storage_mb: 10240 }, features: { custom_domain: true }, per_school: false, public: true, sort: 2,
    prices: [{ key: 'year_usd', interval: 'year', currency: 'usd', amount: 59000 }, { key: 'year_mxn', interval: 'year', currency: 'mxn', amount: 1069000 }] },
].map((p) => ({ ...p, prices: p.prices.map((x) => ({ ...x, stripe_price_id: priceId(p.key, x.key) })) }));
const tenantBilling = {}; // tenant -> billing row
const billingAccounts = []; // { id, name, customer, organisation }
const stripeEvents = new Set();
const referralPartners = [];
const planOf = (key) => PLANS.find((p) => p.key === key) ?? PLANS[0];
const billingUsage = (tenant) => {
  const conf = activeConference(tenant);
  const cs = conf ? committees.filter((c) => c.conference_id === conf.id).map((c) => c.id) : [];
  return {
    committees: cs.length, delegates: delegates.filter((d) => cs.includes(d.committee_id)).length,
    staff: memberships.filter((m) => m.tenant_id === tenant && ['active', 'invited'].includes(m.status)).length,
    active_conferences: conferences.filter((f) => f.tenant_id === tenant && f.status === 'active').length,
  };
};
const entitlementsOf = (tenant) => {
  const b = tenantBilling[tenant];
  const t = tenantRow(tenant);
  if (!b) return { metered: false, status: t?.status, limits: {}, features: {} };
  return { metered: true, plan: b.plan_key, status: t?.status, billing_status: b.billing_status, limits: { ...planOf(b.plan_key).limits, ...b.limit_overrides }, features: planOf(b.plan_key).features,
    trial_ends_at: b.trial_ends_at, grace_until: b.grace_until, pass_until: b.pass_until ?? null, current_period_end: b.current_period_end, cancel_at_period_end: b.cancel_at_period_end, scheduled_plan_key: b.scheduled_plan_key };
};
const overLimit = (tenant, what) => {
  const e = entitlementsOf(tenant);
  const max = e.metered ? e.limits[what] : null;
  return typeof max === 'number' && billingUsage(tenant)[what] >= max ? { status: 400, body: { code: '54000', message: `plan limit reached: ${what} (${max})` } } : null;
};
const accountOf = (tenant) => billingAccounts.find((a) => a.id === tenantBilling[tenant]?.account_id);
const applyBillingState = (tenant) => {
  const b = tenantBilling[tenant];
  const t = tenantRow(tenant);
  if (!b || !t || ['suspended', 'deleted'].includes(t.status)) return;
  t.status = b.billing_status === 'trialing' ? (Date.parse(b.trial_ends_at ?? 0) > Date.now() ? 'trialing' : 'read_only')
    : b.billing_status === 'active' ? 'active'
    : ['past_due', 'unpaid'].includes(b.billing_status) ? (Date.parse(b.grace_until ?? 0) > Date.now() ? 'past_due' : 'read_only') : 'read_only';
};
Object.assign(rpcs, {
  plans_public: () => ({ body: PLANS.filter((p) => p.public).map((p) => without(p, 'public', 'sort')) }),
  tenant_limits: ({ p_tenant }, userId) => (memberOf(userId, p_tenant) ? { body: { ...entitlementsOf(p_tenant), usage: billingUsage(p_tenant) } } : { body: null }),
  billing_state: ({ p_tenant }, userId) => {
    if (!can(userId, p_tenant, 'tenant.manage')) return { body: null };
    const b = tenantBilling[p_tenant];
    return { body: { ...entitlementsOf(p_tenant), usage: billingUsage(p_tenant), organisation: accountOf(p_tenant)?.organisation ?? null, has_customer: !!accountOf(p_tenant)?.customer, has_subscription: !!b?.subscription } };
  },
  billing_server_get: ({ p_tenant }) => {
    const t = tenantRow(p_tenant);
    const b = tenantBilling[p_tenant];
    const a = accountOf(p_tenant);
    return { body: { tenant_id: t.id, slug: t.slug, name: t.name, status: t.status, plan_key: b?.plan_key ?? null, price_key: b?.price_key ?? null, billing_status: b?.billing_status ?? null, account_id: a?.id ?? null, customer: a?.customer ?? null, organisation: a?.organisation ?? false, subscription: b?.subscription ?? null, schools: 1 } };
  },
  billing_server_set: ({ p_tenant, p_data }) => {
    const b = (tenantBilling[p_tenant] ??= { plan_key: null, billing_status: 'trialing', limit_overrides: {}, cancel_at_period_end: false });
    if (p_data.customer && !accountOf(p_tenant)) {
      const a = { id: randomUUID(), name: tenantRow(p_tenant).name, customer: p_data.customer, organisation: false };
      billingAccounts.push(a);
      b.account_id = a.id;
    }
    if ('scheduled_plan_key' in p_data) b.scheduled_plan_key = p_data.scheduled_plan_key || null;
    if ('cancel_at_period_end' in p_data) b.cancel_at_period_end = p_data.cancel_at_period_end;
    return { body: true };
  },
  billing_stripe_event: ({ p_event }) => {
    if (stripeEvents.has(p_event.id)) return { body: 'duplicate' };
    stripeEvents.add(p_event.id);
    const o = p_event.data.object;
    const tenant = o.metadata?.tenant_id ?? o.client_reference_id ?? Object.keys(tenantBilling).find((k) => tenantBilling[k].subscription === (o.subscription ?? o.id));
    const b = tenantBilling[tenant];
    if (!b) return { body: 'no school' };
    let result = 'ignored';
    if (p_event.type === 'checkout.session.completed') {
      b.subscription = o.subscription ?? b.subscription;
      if (o.metadata?.referral_code) b.referral_code = o.metadata.referral_code;
      result = 'linked';
    } else if (p_event.type.startsWith('customer.subscription.')) {
      const plan = PLANS.find((p) => p.prices.some((x) => x.stripe_price_id === o.items.data[0].price.id));
      Object.assign(b, { subscription: o.id, billing_status: p_event.type.endsWith('deleted') ? 'canceled' : o.status, plan_key: plan?.key ?? b.plan_key,
        current_period_end: new Date(o.items.data[0].current_period_end * 1000).toISOString(), cancel_at_period_end: !!o.cancel_at_period_end, grace_until: ['active', 'trialing'].includes(o.status) ? null : b.grace_until });
      if (plan?.key === b.scheduled_plan_key) b.scheduled_plan_key = null;
      result = 'subscription';
    } else if (p_event.type === 'invoice.payment_failed') {
      Object.assign(b, { billing_status: 'past_due', grace_until: b.grace_until ?? new Date(Date.now() + 7 * 86400000).toISOString() });
      result = 'payment failed';
    }
    applyBillingState(tenant);
    return { body: result };
  },
  billing_tick: () => ({ body: 0 }),
  billing_subscriptions: () => ({ body: Object.entries(tenantBilling).filter(([, b]) => b.subscription).map(([tenant_id, b]) => ({ tenant_id, subscription: b.subscription })) }),
  referral_of_promotion: ({ p_promotion }) => ({ body: referralPartners.find((r) => r.stripe_promotion_code_id === p_promotion)?.code ?? null }),
  platform_plans: (_b, userId) => (platformAdmins.has(userId) ? { body: PLANS } : NOT_ADMIN),
  platform_plan_save: ({ p_plan }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const i = PLANS.findIndex((p) => p.key === p_plan.key);
    if (i >= 0) PLANS[i] = { ...PLANS[i], ...p_plan };
    else PLANS.push(p_plan);
    return { body: true };
  },
  platform_billing_set: ({ p_tenant, p_data }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const b = (tenantBilling[p_tenant] ??= { plan_key: p_data.plan_key ?? 'conference', billing_status: 'trialing', trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(), limit_overrides: {}, cancel_at_period_end: false });
    if (p_data.plan_key) b.plan_key = p_data.plan_key;
    if (p_data.limit_overrides) b.limit_overrides = p_data.limit_overrides;
    if (p_data.trial_ends_at) b.trial_ends_at = p_data.trial_ends_at;
    platformAudit(p_tenant, userId, 'platform.billing', p_tenant, p_data);
    applyBillingState(p_tenant);
    return { body: entitlementsOf(p_tenant) };
  },
  platform_tenant_billing: ({ p_tenant }, userId) => (platformAdmins.has(userId) ? { body: { ...entitlementsOf(p_tenant), overrides: tenantBilling[p_tenant]?.limit_overrides ?? null, usage: billingUsage(p_tenant) } } : NOT_ADMIN),
  platform_organisation_attach: ({ p_tenant, p_organisation, p_name }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    let a = billingAccounts.find((x) => x.id === p_organisation && x.organisation);
    if (!a) {
      a = { id: randomUUID(), name: p_name, customer: null, organisation: true };
      billingAccounts.push(a);
    }
    (tenantBilling[p_tenant] ??= { plan_key: 'conference', billing_status: 'trialing', trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(), limit_overrides: {}, cancel_at_period_end: false }).account_id = a.id;
    return { body: a.id };
  },
  platform_billing_overview: (_b, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    const byStatus = {};
    for (const b of Object.values(tenantBilling)) byStatus[b.billing_status] = (byStatus[b.billing_status] ?? 0) + 1;
    return { body: { organisations: billingAccounts.filter((a) => a.organisation).map((a) => ({ id: a.id, name: a.name, schools: Object.entries(tenantBilling).filter(([, b]) => b.account_id === a.id).map(([id]) => ({ id, slug: tenantRow(id)?.slug, status: tenantRow(id)?.status })) })), by_status: byStatus, events: [...stripeEvents].map((id) => ({ id, type: '', result: '', received_at: new Date().toISOString() })) } };
  },
  platform_referrals: (_b, userId) => (platformAdmins.has(userId) ? { body: referralPartners.map((r) => ({ ...r, schools: Object.values(tenantBilling).filter((b) => b.referral_code === r.code).length, paying: 0 })) } : NOT_ADMIN),
  platform_referral_save: ({ p_data }, userId) => {
    if (!platformAdmins.has(userId)) return NOT_ADMIN;
    referralPartners.push({ code: p_data.code, name: p_data.name, percent_off: p_data.percent_off, active: true, stripe_promotion_code_id: p_data.stripe_promotion_code_id });
    return { body: true };
  },
});
// Plan limits on committees made from the committee page.
{
  const save = rpcs.committee_save;
  rpcs.committee_save = (args, userId) => (!args.p_data?.id && overLimit(args.p_tenant, 'committees')) || save(args, userId);
}

// The Stripe stand-in: form-encoded requests in, JSON out, and webhooks to the app signed with
// the test secret, sent before answering (as Stripe would, shortly after).
const WEBHOOK_SECRET = 'whsec_test';
const stripeSubs = new Map();
const formOf = (raw) => Object.fromEntries(new URLSearchParams(raw));
async function webhook(type, object) {
  const payload = JSON.stringify({ id: `evt_${randomBytes(8).toString('hex')}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  await fetch('http://localhost:3100/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: payload }).catch(() => null);
}
async function stripeStandIn(method, url, raw) {
  const f = formOf(raw);
  const id = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;
  if (method === 'POST' && url === '/stripe/v1/customers') return { body: { id: id('cus') } };
  if (method === 'POST' && url === '/stripe/v1/checkout/sessions') {
    const tenant = f.client_reference_id;
    const sub = { id: id('sub'), object: 'subscription', customer: f.customer, status: 'active', cancel_at_period_end: false, metadata: { tenant_id: tenant }, items: { data: [{ id: id('si'), price: { id: f['line_items[0][price]'] }, quantity: Number(f['line_items[0][quantity]'] ?? 1), current_period_end: Math.floor(Date.now() / 1000) + 365 * 86400 }] } };
    stripeSubs.set(sub.id, sub);
    await webhook('checkout.session.completed', { object: 'checkout.session', mode: f.mode, customer: f.customer, subscription: sub.id, client_reference_id: tenant, metadata: { tenant_id: tenant } });
    await webhook('customer.subscription.created', sub);
    return { body: { id: id('cs'), url: f.success_url } };
  }
  if (method === 'POST' && url === '/stripe/v1/billing_portal/sessions') return { body: { id: id('bps'), url: `${f.return_url}?portal=1` } };
  if (method === 'GET' && url.startsWith('/stripe/v1/invoices')) {
    const customer = new URL(url, 'http://x').searchParams.get('customer');
    const has = [...stripeSubs.values()].some((s) => s.customer === customer);
    return { body: { data: has ? [{ id: id('in'), number: 'SESS-0001', status: 'paid', amount_due: 59000, amount_paid: 59000, currency: 'usd', created: Math.floor(Date.now() / 1000), hosted_invoice_url: 'https://invoice.stripe.test/x', invoice_pdf: null }] : [] } };
  }
  const subUrl = /^\/stripe\/v1\/subscriptions\/(sub_\w+)$/.exec(url);
  if (subUrl) {
    const sub = stripeSubs.get(subUrl[1]);
    if (!sub) return { status: 404, body: { error: { message: 'No such subscription' } } };
    if (method === 'POST') {
      if ('cancel_at_period_end' in f) sub.cancel_at_period_end = f.cancel_at_period_end === 'true';
      if (f['items[0][price]']) sub.items.data[0].price.id = f['items[0][price]'];
      await webhook('customer.subscription.updated', sub);
    }
    return { body: sub };
  }
  if (method === 'POST' && url.startsWith('/stripe/v1/subscription_schedules')) return { body: { id: id('sub_sched') } };
  if (method === 'POST' && ['/stripe/v1/products', '/stripe/v1/prices', '/stripe/v1/coupons', '/stripe/v1/promotion_codes'].includes(url)) return { body: { id: id(url.split('/').pop().slice(0, 4)) } };
  return { status: 404, body: { error: { message: `no stand-in for ${method} ${url}` } } };
}

const SERVICE_ONLY = new Set(['resolve_tenant', 'find_account', 'complete_onboarding', 'activate_invitations', 'config_published', 'live_load', 'live_commit', 'display_register', 'display_view', 'live_channel', 'public_site', 'impersonation_claim', 'impersonation_status', 'impersonation_end', 'feature_flags_for', 'platform_announcements_live', 'billing_server_get', 'billing_server_set', 'billing_stripe_event', 'billing_tick', 'billing_subscriptions', 'referral_of_promotion', 'contact_submit', 'contact_mark_emailed']);

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
    if ((req.url ?? '').startsWith('/stripe/')) {
      if (req.headers.authorization !== 'Bearer sk_test_mock') return send({ status: 401, body: { error: { message: 'Invalid API key' } } });
      return void stripeStandIn(req.method, req.url, raw).then(send);
    }
    // Test hook: a school's billing goes read-only (or back), as the daily job would set it.
    if (req.method === 'POST' && req.url === '/__test/billing-status') {
      const b = JSON.parse(raw);
      tenantRow(b.tenant).status = b.status;
      return send({ body: { ok: true } });
    }
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
    // Test hook: every support session in force expires now.
    if (req.method === 'POST' && req.url === '/__test/expire-impersonations') {
      for (const i of impersonations) if (!i.ended_at) i.expires_at = new Date(Date.now() - 1000).toISOString();
      return send({ body: { ok: true } });
    }
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
      requestImpersonation = req.headers['x-sessional-impersonation'] ?? null;
      try {
        return send(rpcs[rpc[1]](body, userId));
      } finally {
        requestImpersonation = null;
      }
    }

    // Provider sign-in: the browser comes here, and goes straight back with a code.
    if (req.method === 'GET' && (req.url ?? '').startsWith('/auth/v1/authorize?')) {
      const q = new URL(req.url, 'http://mock').searchParams;
      const who = byEmail(OAUTH_USERS[q.get('provider')] ?? '');
      if (!who || q.get('code_challenge_method') !== 's256') return send({ status: 400, body: { msg: 'bad request' } });
      const code = randomBytes(16).toString('hex');
      oauthCodes.set(code, { userId: who.id, challenge: q.get('code_challenge'), provider: q.get('provider') });
      res.writeHead(302, { location: `${q.get('redirect_to')}?code=${code}` });
      return res.end();
    }
    if (req.method === 'POST' && req.url === '/auth/v1/token?grant_type=pkce') {
      const found = oauthCodes.get(body.auth_code);
      oauthCodes.delete(body.auth_code);
      if (!found || createHash('sha256').update(String(body.code_verifier)).digest('base64url') !== found.challenge) return send({ status: 400, body: { error_code: 'flow_state_not_found' } });
      const u = users.get(found.userId);
      return send({ body: { ...issue(u.id), user: { id: u.id, email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: found.provider } } } });
    }
    const handler = auth[`${req.method} ${req.url}`];
    if (handler) {
      if (key !== ANON && key !== SERVICE) return send({ status: 401, body: {} });
      return send(handler(body, sessions.get(token), token));
    }
    send({ status: 404, body: { message: `no mock for ${req.method} ${req.url}` } });
  });
}).listen(PORT, () => console.log(`mock supabase on ${PORT}`));
