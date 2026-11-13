import { exportPack } from '@/config/pack';
import { resolveSection } from '@/config/resolve';
import { SECTION_NAMES, type SectionName } from '@/config/schema';
import { editorState } from '@/config/store';
import { resolveTenant } from '@/tenancy/directory';
import { tenantContext } from '@/tenancy/context';
import { parseTenantKey } from '@/tenancy/route';

// Downloads one settings section as a pack: what the editor currently sees (the draft if there is
// one, otherwise what is live). Needs the same permission as editing.
export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string; section: string }> }) {
  const { tenant: key, section } = await params;
  const address = parseTenantKey(key);
  const found = address ? await resolveTenant(address) : null;
  if (found?.kind !== 'tenant' || found.tenant.status === 'suspended' || found.tenant.status === 'deleted') return new Response(null, { status: 404 });
  if (!(SECTION_NAMES as string[]).includes(section)) return new Response(null, { status: 404 });

  const ctx = await tenantContext(found.tenant.id);
  if (!ctx?.can('tenant.manage')) return new Response(null, { status: 403 });

  const state = await editorState(found.tenant.id, ctx.token);
  const s = state[section];
  const data = resolveSection(section as SectionName, s?.draft ?? s?.published).data;
  const pack = exportPack(section as SectionName, data);
  return new Response(`${JSON.stringify(pack, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${found.tenant.slug}-${section}.json"`,
      'cache-control': 'no-store',
    },
  });
}
