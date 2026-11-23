import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type TenantConfig } from '@/config/schema';
import { standardStructure } from '@/structure/presets';

vi.mock('server-only', () => ({}));
const answer = vi.fn();
vi.mock('@/data/rpc', () => ({ rpc: (...args: unknown[]) => answer(...args) }));

// What the database might send, including fields that must never reach a visitor (as if a later
// migration added them by mistake).
const ROW = {
  conference: { name: 'MUN 2026', id: 'conf-id', secrets_unlocked_at: null },
  committees: [
    {
      id: 'c1', name: 'Security Council', abbreviation: 'SC', topic: 'Space debris', category_key: null, type_key: 'standard', secret: 'leak',
      delegations: [{ label: 'Brazil', flag: null, group_key: null, name: 'Ana Souza', id: 'd1' }],
      resolutions: [{ code: 'SC/1', title: 'On peace', kind: 'resolution', body: 'full text', sponsors: ['d1'] }],
    },
    { id: 'c2', name: 'Crisis Cabinet', abbreviation: 'CC', topic: 'The secret plot', category_key: null, type_key: 'crisis', delegations: [], resolutions: [] },
  ],
  schedule: [{ starts_at: '2026-03-12T09:00:00Z', ends_at: '2026-03-12T10:00:00Z', title: 'Opening', kind: 'ceremony', location: 'Hall', session_number: null, id: 's1', created_by: 'u1' }],
};

const config = (publicSite: Partial<TenantConfig['publicSite']>, modules: Partial<TenantConfig['modules']> = {}): TenantConfig => {
  const c = defaultConfig();
  return { ...c, structure: standardStructure(), publicSite: { ...c.publicSite, ...publicSite }, modules: { ...c.modules, ...modules } };
};

beforeEach(() => {
  answer.mockReset();
  answer.mockResolvedValue(structuredClone(ROW));
});

describe('the public pages', () => {
  it('are off until the Owner turns them on, without asking the database', async () => {
    const { loadPublicSite } = await import('@/public/site');
    expect(await loadPublicSite('t1', config({}))).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it('pass whitelisted fields only, from the server role, with confidential topics blanked', async () => {
    const { loadPublicSite } = await import('@/public/site');
    const site = (await loadPublicSite('t1', config({ enabled: 'on' })))!;
    expect(answer).toHaveBeenCalledWith('public_site', { p_tenant: 't1' }, 'service');
    expect(site.conference).toEqual({ name: 'MUN 2026' });
    expect(Object.keys(site.committees[0]!).sort()).toEqual(['abbreviation', 'category_key', 'delegations', 'id', 'name', 'resolutions', 'topic', 'type_key']);
    expect(site.committees[0]!.delegations).toEqual([{ label: 'Brazil', flag: null, group_key: null }]);
    expect(site.committees[0]!.resolutions).toEqual([{ code: 'SC/1', title: 'On peace', kind: 'resolution' }]);
    expect(site.committees[1]!.topic).toBe('');
    expect(site.schedule[0]).toEqual({ starts_at: '2026-03-12T09:00:00Z', ends_at: '2026-03-12T10:00:00Z', title: 'Opening', kind: 'ceremony', location: 'Hall', session_number: null });
    expect(JSON.stringify(site)).not.toMatch(/Ana Souza|leak|full text|secret plot|conf-id|created_by/);
  });

  it('leave out each part the school switched off, and parts whose module is off', async () => {
    const { loadPublicSite } = await import('@/public/site');
    const site = (await loadPublicSite('t1', config({ enabled: 'on', delegations: 'off', resolutions: 'on' }, { documents: 'off', schedule: 'off' })))!;
    expect(site.show).toEqual({ delegations: false, schedule: false, resolutions: false, live: false });
    expect(site.committees.every((c) => c.delegations.length === 0 && c.resolutions.length === 0)).toBe(true);
    expect(site.schedule).toEqual([]);
  });

  it('show a committee live only when the school publishes the live view', async () => {
    const { publicLiveView } = await import('@/public/site');
    expect(await publicLiveView('t1', config({ enabled: 'on' }), 'c1')).toBeNull();
    answer.mockImplementation(async (name: string) =>
      name === 'public_site' ? structuredClone(ROW) : { tenant_id: 't1', revision: 3, state: {}, session_protocol: null, type_key: 'standard', delegates: [{ id: 'd1', label: 'Brazil', flag: null, group_key: null }] },
    );
    const view = (await publicLiveView('t1', config({ enabled: 'on', live: 'on' }), 'c1'))!;
    expect(view).toMatchObject({ paired: true, revision: 3, realtime: null, committee: { name: 'Security Council', abbreviation: 'SC', topic: 'Space debris' } });
    expect(view.delegates.d1).toMatchObject({ label: 'Brazil' });
    expect(await publicLiveView('t1', config({ enabled: 'on', live: 'on' }), 'nope')).toBeNull();
    // A committee of another school is never shown, even if asked by id.
    answer.mockImplementation(async (name: string) => (name === 'public_site' ? structuredClone(ROW) : { tenant_id: 'other', revision: 1, state: {}, session_protocol: null, type_key: 'standard', delegates: [] }));
    expect(await publicLiveView('t1', config({ enabled: 'on', live: 'on' }), 'c1')).toBeNull();
  });
});
