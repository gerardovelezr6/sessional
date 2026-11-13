import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { enabledLocales, tenantTranslator } from '@/config/store';
import { languageName } from '@/i18n/locales';
import { localize } from '@/messages';
import { typeOf } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { reorderCommitteesAction, saveCommitteeAction, setUnlockAction, startConferenceAction } from './actions';
import { CommitteeList, type ListGroup } from './CommitteeList';
import { CommitteeFields } from './CommitteeFields';
import { choicesFor, groupByCategory, hasPassed, loadOverview } from './data';
import { UnlockForm } from './UnlockForm';

const DONE = { added: 'committee.saved', deleted: 'committee.deleted', secrets: 'committee.saved' } as const;

export default async function CommitteesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.membership) redirect(`${base}/`);

  const { done } = await searchParams;
  const manage = ctx.can('committee.manage');
  const overview = await loadOverview(tenant.id, ctx.token);
  const structure = config.structure;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: config.identity.timeZone });

  if (!overview.conference) {
    return (
      <Shell title={t('committees.title')} size="wide" locale={locale}>
        {manage ? (
          <section className="card flex flex-col gap-3" aria-labelledby="start-title">
            <h2 id="start-title" className="text-lg font-bold text-on-surface">
              {t('committees.start.title')}
            </h2>
            <p className="text-sm">{t('committees.start.help')}</p>
            <ActionForm action={startConferenceAction.bind(null, key)} submitLabel={t('committees.start.submit')}>
              <label className="flex flex-col gap-1">
                <span className="label">{t('committees.start.name')}</span>
                <input className="input" name="name" required maxLength={120} defaultValue={tenant.name} />
              </label>
            </ActionForm>
          </section>
        ) : (
          <p className="card">{t('committees.waiting')}</p>
        )}
      </Shell>
    );
  }

  const conference = overview.conference;
  const groups: ListGroup[] = groupByCategory(structure, overview.committees).map((g) => ({
    key: g.category?.key ?? '_other',
    title: g.category ? localize(g.category.name, locale, g.category.key) : t('committees.uncategorised'),
    color: g.category?.color ?? null,
    items: g.committees.map((c) => ({
      id: c.id,
      name: c.name,
      abbreviation: c.abbreviation,
      topic: c.topic,
      type: localize(typeOf(structure, c.type_key).name, locale, c.type_key),
      delegates: t('committees.count.delegates', { count: c.delegates }),
      chairs: c.chairs.length ? t('committees.chairs', { names: c.chairs.map((x) => x.name).join(', ') }) : t('committees.chairs.none'),
      href: `${base}/committees/${c.id}`,
    })),
  }));

  const unlockedAt = conference.secrets_unlocked_at ? new Date(conference.secrets_unlocked_at) : null;
  const hasSecrets = structure.types.some((x) => x.confidentialTopic);
  const languages = enabledLocales(config);
  const message = done && done in DONE ? t(DONE[done as keyof typeof DONE]) : null;

  return (
    <Shell title={t('committees.title')} size="wide" locale={locale}>
      <div className="flex flex-col gap-6">
        <p className="text-sm text-on-surface-muted">{conference.name}</p>
        {message ? (
          <p role="status" className="card font-semibold text-on-surface">
            {message}
          </p>
        ) : null}

        {groups.length ? (
          <CommitteeList
            groups={groups}
            canReorder={manage}
            reorder={reorderCommitteesAction.bind(null, key)}
            L={{ help: t('committees.order.help'), up: t('committees.order.up', { name: '{name}' }), down: t('committees.order.down', { name: '{name}' }), error: t('committees.order.error'), saving: t('committees.order.saving'), saved: t('committees.order.saved') }}
          />
        ) : (
          <p className="card">{t('committees.empty')}</p>
        )}

        {manage ? (
          <section className="card flex flex-col gap-3" aria-labelledby="add-title">
            <h2 id="add-title" className="text-lg font-bold text-on-surface">
              {t('committees.add.title')}
            </h2>
            <ActionForm action={saveCommitteeAction.bind(null, key, null)} submitLabel={t('committees.add.submit')}>
              <CommitteeFields
                choices={choicesFor(structure, locale)}
                languages={languages.map((l) => ({ code: l, name: languageName(l, locale) }))}
                defaultLanguage={t('committees.language.default', { language: languageName(config.locale.defaultLocale, locale) })}
                L={{ name: t('committees.field.name'), abbreviation: t('committees.field.abbreviation'), category: t('committees.field.category'), type: t('committees.field.type'), language: t('committees.field.language'), topic: t('committees.field.topic'), description: t('committees.field.description'), noCategory: t('structure.type.noCategory') }}
              />
            </ActionForm>
          </section>
        ) : null}

        {manage && hasSecrets ? (
          <section id="secrets" className="card flex flex-col gap-3" aria-labelledby="secrets-title">
            <h2 id="secrets-title" className="text-lg font-bold text-on-surface">
              {t('committees.secrets.title')}
            </h2>
            <p className="text-sm">
              {!unlockedAt ? t('committees.secrets.hidden') : hasPassed(conference.secrets_unlocked_at!) ? t('committees.secrets.shown', { date: when.format(unlockedAt) }) : t('committees.secrets.scheduled', { date: when.format(unlockedAt) })}
            </p>
            <UnlockForm
              action={setUnlockAction.bind(null, key, conference.id)}
              shown={!!unlockedAt}
              L={{ showNow: t('committees.secrets.showNow'), showAt: t('committees.secrets.showAt'), schedule: t('committees.secrets.schedule'), hide: t('committees.secrets.hide') }}
            />
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
