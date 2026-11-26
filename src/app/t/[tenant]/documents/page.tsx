import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { sizeOf, type ConferenceDocument } from '@/documents/format';

// The conference's documents, for its members: what the people running it shared with everyone
// (and, for staff, with staff).
export default async function Documents({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.membership) redirect(`${base}/login`);
  const docs = (await rpc<ConferenceDocument[] | null>('conference_documents_list', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null)) ?? [];
  return (
    <Shell title={t('confdocs.title')} wide locale={locale}>
      {docs.length ? (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li key={d.id} className="card flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0">
                <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/documents/${d.id}`}>
                  {d.title}
                </a>
                {d.description ? <span className="block text-sm">{d.description}</span> : null}
              </span>
              <span className="text-xs">
                {d.file_name} · {sizeOf(d.size_bytes, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card">{t('confdocs.noneYet')}</p>
      )}
    </Shell>
  );
}
