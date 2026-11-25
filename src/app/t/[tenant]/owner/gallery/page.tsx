import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { SECTION_LABELS } from '@/config/registry';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { isShareable, SHAREABLE } from '@/gallery/sections';
import { localize } from '@/messages';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { installGalleryAction } from '../../settings/actions';

// Owner → Community gallery: designs, words, committee types, rules of procedure, rubrics and
// printing styles other schools shared, reviewed by Sessional. Installing makes a draft, which the
// school checks and publishes (and can roll back) like any change.

export interface GalleryCard {
  id: string;
  section: string;
  author: string;
  name: Record<string, string>;
  description: Record<string, string>;
  installs: number;
  version: number;
  updated_at: string;
}

export default async function GalleryPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ section?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const asked = (await searchParams).section ?? '';
  const section = isShareable(asked) ? asked : null;
  const [cards, installed] = await Promise.all([
    rpc<GalleryCard[]>('gallery_list', { p_section: section }, { token: ctx.token }).catch(() => []),
    rpc<{ pack_id: string; version: number }[] | null>('gallery_installs_of', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null),
  ]);
  const mine = new Map((installed ?? []).map((i) => [i.pack_id, i.version]));

  return (
    <Shell title={t('gallery.title')} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="overview" />
      <div className="flex max-w-5xl flex-col gap-5">
        <p className="text-sm">{t('gallery.help')}</p>
        <p>
          <a className="btn btn-secondary" href={`${base}/owner/gallery/share${section ? `?section=${section}` : ''}`}>
            {t('gallery.shareYours')}
          </a>
        </p>
        <nav aria-label={t('gallery.filter')} className="flex flex-wrap gap-2">
          <a href={`${base}/owner/gallery`} aria-current={section ? undefined : 'page'} className={`btn btn-sm ${section ? 'btn-secondary' : 'btn-primary'}`}>
            {t('gallery.all')}
          </a>
          {SHAREABLE.map((s) => (
            <a key={s} href={`${base}/owner/gallery?section=${s}`} aria-current={s === section ? 'page' : undefined} className={`btn btn-sm ${s === section ? 'btn-primary' : 'btn-secondary'}`}>
              {t(SECTION_LABELS[s])}
            </a>
          ))}
        </nav>
        {cards.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('gallery.title')}>
            {cards.map((c) => {
              const have = mine.get(c.id);
              const name = localize(c.name, locale, t('gallery.untitled'));
              return (
                <li key={c.id} className="card flex flex-col gap-2">
                  <h2 className="text-lg font-bold text-on-surface">
                    <a className="underline-offset-2 hover:underline" href={`${base}/owner/gallery/${c.id}`}>
                      {name}
                    </a>
                  </h2>
                  <p className="text-xs">{t('gallery.meta', { section: t(SECTION_LABELS[c.section as keyof typeof SECTION_LABELS]), school: c.author, version: c.version, installs: c.installs })}</p>
                  {localize(c.description, locale, '') ? <p className="text-sm">{localize(c.description, locale, '')}</p> : null}
                  {have ? <p className="text-sm font-semibold text-on-surface">{have < c.version ? t('gallery.newer', { have, version: c.version }) : t('gallery.installedVersion', { version: have })}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2">
                    {!have || have < c.version ? (
                      <ActionForm action={installGalleryAction.bind(null, key, c.id, c.version)} submitLabel={t(have ? 'gallery.installNewer' : 'gallery.install', { name, version: c.version })} variant="secondary" />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card">{t(section ? 'gallery.emptySection' : 'gallery.empty')}</p>
        )}
      </div>
    </Shell>
  );
}
