import { notFound, redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { SECTION_LABELS } from '@/config/registry';
import type { SectionName } from '@/config/schema';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { packSummary } from '@/gallery/sections';
import { regional } from '@/i18n/regional';
import { localize } from '@/messages';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { installGalleryAction } from '../../../settings/actions';
import type { GalleryCard } from '../page';

// One pack in the community gallery: what it changes, and every approved version with its notes.
// Any version can be installed as a draft.
export default async function GalleryPackPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: key, id } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const pack = await rpc<(GalleryCard & { versions: { version: number; notes: Record<string, string>; approved_at: string }[] }) | null>('gallery_get', { p_pack: id }, { token: ctx.token }).catch(() => null);
  if (!pack) notFound();
  const [latest, installed] = await Promise.all([
    rpc<{ data: Record<string, unknown> } | null>('gallery_version_data', { p_pack: id, p_version: pack.version }, { token: ctx.token }).catch(() => null),
    rpc<{ pack_id: string; version: number }[] | null>('gallery_installs_of', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null),
  ]);
  const have = installed?.find((i) => i.pack_id === id)?.version;
  const changes = latest ? packSummary(pack.section as SectionName, latest.data) : [];
  const name = localize(pack.name, locale, t('gallery.untitled'));
  const day = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'medium' });

  return (
    <Shell title={name} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="overview" />
      <div className="flex max-w-4xl flex-col gap-5">
        <p>
          <a className="text-sm font-semibold underline underline-offset-2" href={`${base}/owner/gallery?section=${pack.section}`}>
            {t('gallery.back')}
          </a>
        </p>
        <section className="card flex flex-col gap-2" aria-labelledby="about-pack">
          <h2 id="about-pack" className="sr-only">
            {t('gallery.about')}
          </h2>
          <p className="text-sm">{t('gallery.meta', { section: t(SECTION_LABELS[pack.section as SectionName]), school: pack.author, version: pack.version, installs: pack.installs })}</p>
          {localize(pack.description, locale, '') ? <p>{localize(pack.description, locale, '')}</p> : null}
          <h3 className="label-text mt-2">{t('gallery.changes')}</h3>
          {changes.length ? (
            <ul className="list-disc ps-5 text-sm">
              {changes.map((c) => (
                <li key={c}>{t(c)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">{t('gallery.changes.none')}</p>
          )}
          <p className="text-sm">{t('gallery.installNote')}</p>
          {have ? <p className="text-sm font-semibold text-on-surface">{t('gallery.installedVersion', { version: have })}</p> : null}
        </section>
        <section className="card flex flex-col gap-3" aria-labelledby="versions">
          <h2 id="versions" className="text-lg font-bold text-on-surface">
            {t('gallery.versions')}
          </h2>
          <ol className="flex flex-col gap-3">
            {pack.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <span className="min-w-60 flex-1 text-sm">
                  <span className="block font-semibold text-on-surface">
                    {t('gallery.versionLine', { version: v.version, when: day.format(new Date(v.approved_at)) })}
                    {v.version === have ? ` · ${t('gallery.yours')}` : ''}
                  </span>
                  {localize(v.notes, locale, '') ? <span className="block">{localize(v.notes, locale, '')}</span> : null}
                </span>
                <ActionForm action={installGalleryAction.bind(null, key, id, v.version)} submitLabel={t('gallery.installVersion', { version: v.version })} variant="secondary" />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Shell>
  );
}
