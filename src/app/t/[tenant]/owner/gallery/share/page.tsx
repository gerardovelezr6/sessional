import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { SECTION_LABELS } from '@/config/registry';
import type { SectionName } from '@/config/schema';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { isShareable, SHAREABLE } from '@/gallery/sections';
import { regional } from '@/i18n/regional';
import { localize, type MessageKey } from '@/messages';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import type { GalleryCard } from '../page';
import { setHiddenAction, shareAction } from '../actions';

// Owner → Community gallery → Share: one published settings section, as a new pack or as the next
// version of one of the school's packs. Sessional reviews it before other schools see it.

interface Mine extends GalleryCard {
  hidden: boolean;
  hidden_by_admin: boolean;
  versions: { version: number; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; review_note: string; submitted_at: string }[];
}

export default async function SharePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ section?: string; done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const { section: asked, done } = await searchParams;
  const section = isShareable(asked ?? '') ? asked : 'theme';
  const mine = (await rpc<Mine[] | null>('gallery_mine', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null)) ?? [];
  const day = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'medium' });
  const label = (s: string) => t(SECTION_LABELS[s as SectionName]);

  return (
    <Shell title={t('gallery.share.title')} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="overview" />
      <div className="flex max-w-4xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(`gallery.done.${done}` as MessageKey)}
          </p>
        ) : null}
        <p>
          <a className="text-sm font-semibold underline underline-offset-2" href={`${base}/owner/gallery`}>
            {t('gallery.back')}
          </a>
        </p>
        <section className="card flex flex-col gap-3" aria-labelledby="share-form">
          <h2 id="share-form" className="text-lg font-bold text-on-surface">
            {t('gallery.share.heading')}
          </h2>
          <ul className="list-disc ps-5 text-sm">
            <li>{t('gallery.share.what')}</li>
            <li>{t('gallery.share.never')}</li>
            <li>{t('gallery.share.review')}</li>
          </ul>
          <ActionForm action={shareAction.bind(null, key)} submitLabel={t('gallery.share.submit')}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="label">{t('gallery.share.section')}</span>
                <select className="input" name="section" defaultValue={section}>
                  {SHAREABLE.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('gallery.share.as')}</span>
                <select className="input" name="pack" defaultValue="">
                  <option value="">{t('gallery.share.new')}</option>
                  {mine.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t('gallery.share.nextOf', { name: localize(m.name, locale, t('gallery.untitled')), section: label(m.section) })}
                    </option>
                  ))}
                </select>
              </label>
              {(['en', 'es'] as const).map((l) => (
                <label key={`name-${l}`} className="flex flex-col gap-1">
                  <span className="label">{t(l === 'en' ? 'gallery.share.nameEn' : 'gallery.share.nameEs')}</span>
                  <input className="input" name={`name_${l}`} maxLength={80} autoComplete="off" />
                </label>
              ))}
              {(['en', 'es'] as const).map((l) => (
                <label key={`description-${l}`} className="flex flex-col gap-1">
                  <span className="label">{t(l === 'en' ? 'gallery.share.descriptionEn' : 'gallery.share.descriptionEs')}</span>
                  <textarea className="input" name={`description_${l}`} maxLength={300} rows={2} />
                </label>
              ))}
              {(['en', 'es'] as const).map((l) => (
                <label key={`notes-${l}`} className="flex flex-col gap-1">
                  <span className="label">{t(l === 'en' ? 'gallery.share.notesEn' : 'gallery.share.notesEs')}</span>
                  <input className="input" name={`notes_${l}`} maxLength={300} autoComplete="off" />
                </label>
              ))}
            </div>
            <p className="text-xs">{t('gallery.share.nameHelp')}</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="consent" value="yes" required className="mt-1" />
              <span>{t('gallery.share.consent')}</span>
            </label>
          </ActionForm>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="mine">
          <h2 id="mine" className="text-lg font-bold text-on-surface">
            {t('gallery.mine.title')}
          </h2>
          {mine.length ? (
            <ul className="flex flex-col gap-3">
              {mine.map((m) => (
                <li key={m.id} className="card flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold text-on-surface">{localize(m.name, locale, t('gallery.untitled'))}</h3>
                    <span className="text-xs">
                      {label(m.section)} · {t('gallery.installs', { installs: m.installs })}
                      {m.hidden ? ` · ${t(m.hidden_by_admin ? 'gallery.mine.removed' : 'gallery.mine.hidden')}` : ''}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 text-sm">
                    {m.versions.slice(0, 4).map((v) => (
                      <li key={v.version}>
                        <span className="font-semibold text-on-surface">{t('gallery.mine.version', { version: v.version, when: day.format(new Date(v.submitted_at)) })}</span>{' '}
                        <span className={`badge ${v.status === 'approved' ? 'tone-live' : v.status === 'rejected' ? 'tone-danger' : 'tone-paused'}`}>{t(`gallery.status.${v.status}`)}</span>
                        {v.status === 'rejected' && v.review_note ? <span className="block">{t('gallery.mine.why', { note: v.review_note })}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {m.hidden_by_admin ? null : (
                    <div>
                      <ActionForm action={setHiddenAction.bind(null, key, m.id, !m.hidden)} submitLabel={t(m.hidden ? 'gallery.mine.list' : 'gallery.mine.hide')} variant="secondary" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="card">{t('gallery.mine.none')}</p>
          )}
        </section>
      </div>
    </Shell>
  );
}
