import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Shell } from '@/components/Shell';
import { enabledLocales, tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { assetUrl } from '@/data/storage';
import { countryCodes, countryName } from '@/i18n/countries';
import { languageName } from '@/i18n/locales';
import { localize, messageFor, type MessageKey } from '@/messages';
import { flagFor, US_STATE_CODES, usStateName } from '@/structure/flags';
import { typeOf } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadPeople } from '../../people/data';
import { addDelegatesAction, deleteCommitteeAction, deleteDelegateAction, saveCommitteeAction, setChairsAction, setSecretAction, updateDelegateAction } from '../actions';
import { CommitteeFields } from '../CommitteeFields';
import { choicesFor, loadCommittee } from '../data';
import { Delegates } from './Delegates';

const DONE: Record<string, MessageKey> = { saved: 'committee.saved', chairs: 'committee.saved', secret: 'committee.saved', delegate: 'delegates.saved', removed: 'delegates.deleted' };

export default async function CommitteePage({ params, searchParams }: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ done?: string; count?: string }> }) {
  const { tenant: key, id } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.membership) redirect(`${base}/`);

  const detail = await loadCommittee(tenant.id, id, ctx.token);
  if (!detail) notFound();
  const { committee } = detail;
  const query = await searchParams;
  const structure = config.structure;
  const type = typeOf(structure, committee.type_key);
  const manage = ctx.can('committee.manage');
  const isChair = detail.chairs.includes(ctx.user.id);
  const seesDelegates = manage || (isChair && (ctx.can('committee.run') || ctx.can('delegates.manage')));
  const editsDelegates = manage || (isChair && ctx.can('delegates.manage'));
  const languages = enabledLocales(config);
  const committeeLocale = committee.language ?? config.locale.defaultLocale;

  const canRun = await rpc<boolean>('committee_can_run', { p_committee: committee.id }, { token: ctx.token }).catch(() => false);
  const people = manage ? await loadPeople(tenant.id, ctx.token).catch(() => null) : null;
  const candidates = (people?.members ?? []).filter((m) => m.status !== 'disabled');

  const done = query.done === 'added' ? t('delegates.added', { count: Number(query.count) || 0 }) : query.done && DONE[query.done] ? t(DONE[query.done]!) : null;

  // Patterns for the browser, with the school's own wording, filled in there.
  const pattern = (k: MessageKey) => messageFor(k, locale, config.translations.messages).text;
  const groups = type.groups.map((g) => ({ key: g.key, name: localize(g.name, locale, g.key), short: g.short, color: g.color, logoUrl: assetUrl(tenant.id, g.logo) }));
  const labelField = localize(type.labelField, locale, t('structure.column.label'));
  const groupLabel = localize(type.groupLabel, locale, t('structure.column.group'));
  const fields = type.fields.map((f) => ({ key: f.key, name: localize(f.name, locale, f.key) }));
  const columnName = (c: string) => (c === 'label' ? labelField : c === 'name' ? t('delegates.col.name') : c === 'group' ? groupLabel : (fields.find((f) => f.key === c)?.name ?? c));

  return (
    <Shell title={committee.abbreviation ? `${committee.name} (${committee.abbreviation})` : committee.name} size="wide" locale={locale}>
      <div className="flex flex-col gap-6">
        <p>
          <Link href={`${base}/committees`} className="text-sm font-semibold underline underline-offset-2">
            {t('committee.back')}
          </Link>
        </p>
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {done}
          </p>
        ) : null}
        {canRun ? (
          <Link href={`${base}/committees/${committee.id}/console`} className="card flex flex-col gap-1 hover:border-border-strong">
            <span className="text-lg font-bold text-on-surface">{t('committee.console.open')}</span>
            <span className="text-sm">{t('committee.console.help')}</span>
          </Link>
        ) : null}

        <section className="card flex flex-col gap-3" aria-labelledby="details-title">
          <h2 id="details-title" className="text-lg font-bold text-on-surface">
            {t('committee.details')}
          </h2>
          {manage ? (
            <ActionForm action={saveCommitteeAction.bind(null, key, committee.id)} submitLabel={t('committee.save')}>
              <CommitteeFields
                choices={choicesFor(structure, locale)}
                languages={languages.map((l) => ({ code: l, name: languageName(l, locale) }))}
                defaultLanguage={t('committees.language.default', { language: languageName(config.locale.defaultLocale, locale) })}
                values={committee}
                L={{ name: t('committees.field.name'), abbreviation: t('committees.field.abbreviation'), category: t('committees.field.category'), type: t('committees.field.type'), language: t('committees.field.language'), topic: t('committees.field.topic'), description: t('committees.field.description'), noCategory: t('structure.type.noCategory') }}
              />
            </ActionForm>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-on-surface-muted">{localize(type.name, locale, type.key)}</p>
              {committee.topic ? <p className="text-base text-on-surface">{committee.topic}</p> : null}
              {committee.description ? <p className="whitespace-pre-line">{committee.description}</p> : null}
              <p>{t('committee.language', { language: languageName(committeeLocale, locale) })}</p>
            </div>
          )}
        </section>

        {manage ? (
          <section id="chairs" className="card flex flex-col gap-3" aria-labelledby="chairs-title">
            <h2 id="chairs-title" className="text-lg font-bold text-on-surface">
              {t('committee.chairs.title')}
            </h2>
            <p className="text-sm">{t('committee.chairs.help')}</p>
            {candidates.length ? (
              <ActionForm action={setChairsAction.bind(null, key, committee.id)} submitLabel={t('committee.chairs.save')} variant="secondary">
                <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <legend className="sr-only">{t('committee.chairs.title')}</legend>
                  {candidates.map((m) => (
                    <label key={m.userId} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="chair" value={m.userId} defaultChecked={detail.chairs.includes(m.userId)} />
                      <span className="text-on-surface">{m.fullName || m.email}</span>
                      <span className="text-xs text-on-surface-muted">{localize(m.roleName, locale, m.roleKey)}</span>
                    </label>
                  ))}
                </fieldset>
              </ActionForm>
            ) : (
              <p className="text-sm">{t('committee.chairs.none')}</p>
            )}
          </section>
        ) : null}

        {type.confidentialTopic ? (
          <section id="secret" className="card flex flex-col gap-3" aria-labelledby="secret-title">
            <h2 id="secret-title" className="text-lg font-bold text-on-surface">
              {t('committee.secret.title')}
            </h2>
            {manage ? (
              <>
                <p className="text-sm">{t('committee.secret.help')}</p>
                <ActionForm action={setSecretAction.bind(null, key, committee.id)} submitLabel={t('committee.secret.save')} variant="secondary">
                  <textarea className="input min-h-24" name="secret" maxLength={2000} defaultValue={detail.secret ?? ''} aria-label={t('committee.secret.title')} />
                </ActionForm>
              </>
            ) : // The database returns the topic to a chair only once topics are shown.
            detail.secret ? (
              <p className="whitespace-pre-line text-on-surface">{detail.secret}</p>
            ) : (
              <p className="text-sm">{t('committee.secret.hidden')}</p>
            )}
          </section>
        ) : null}

        <section id="delegates" className="card flex flex-col gap-3" aria-labelledby="delegates-title">
          <h2 id="delegates-title" className="text-lg font-bold text-on-surface">
            {t('delegates.title')}
          </h2>
          {seesDelegates ? (
            <Delegates
              type={type}
              labelField={labelField}
              groupLabel={groupLabel}
              groups={groups}
              fields={fields}
              columns={type.bulk.map(columnName)}
              delegates={detail.delegates.map((d) => ({ id: d.id, label: d.label, name: d.name, groupKey: d.group_key, flag: d.flag, extra: d.extra ?? {}, shown: flagFor(type, d, [committeeLocale, ...languages]) }))}
              canEdit={editsDelegates}
              locales={[committeeLocale, ...languages]}
              locale={locale}
              flagOptions={
                editsDelegates
                  ? {
                      countries: countryCodes()
                        .map((c) => ({ code: c.toLowerCase(), name: countryName(c, locale) }))
                        .sort((a, b) => a.name.localeCompare(b.name, locale)),
                      states: US_STATE_CODES.map((c) => ({ code: c, name: usStateName(c) })).sort((a, b) => a.name.localeCompare(b.name, locale)),
                    }
                  : { countries: [], states: [] }
              }
              add={addDelegatesAction.bind(null, key, committee.id)}
              update={updateDelegateAction.bind(null, key, committee.id)}
              remove={deleteDelegateAction.bind(null, key, committee.id)}
              L={{
                empty: t('delegates.empty'), flag: t('delegates.flag'), colName: t('delegates.col.name'), colActions: t('delegates.col.actions'),
                groupNone: t('delegates.group.none'), flagAuto: t('delegates.flag.auto'), flagNone: t('delegates.flag.none'), flagCountries: t('delegates.flag.countries'), flagStates: t('delegates.flag.states'),
                edit: pattern('delegates.edit'), editShort: t('delegates.editShort'), save: t('delegates.save'), cancel: t('delegates.cancel'), delete: pattern('delegates.delete'), confirmDelete: t('delegates.confirmDelete'), deleteShort: t('committee.delete.ask'),
                addTitle: t('delegates.add.title'), addSubmit: t('delegates.add.submit'), bulkTitle: t('delegates.bulk.title'), bulkHelp: pattern('delegates.bulk.help'), bulkText: t('delegates.bulk.text'),
                bulkCheck: t('delegates.bulk.check'), ready: pattern('delegates.bulk.ready'), skipped: pattern('delegates.bulk.skipped'), confirm: pattern('delegates.bulk.confirm'), line: pattern('delegates.bulk.line'), ok: t('delegates.bulk.ok'),
                problem_label: t('delegates.problem.label'), problem_group: t('delegates.problem.group'), problem_duplicate: t('delegates.problem.duplicate'),
              }}
            />
          ) : (
            <p className="text-sm">{t('delegates.notYours')}</p>
          )}
        </section>

        {manage ? (
          <section className="card flex flex-col gap-3" aria-labelledby="delete-title">
            <h2 id="delete-title" className="text-lg font-bold text-on-surface">
              {t('committee.delete.title')}
            </h2>
            <p className="text-sm">{t('committee.delete.help')}</p>
            <div>
              <ConfirmButton action={deleteCommitteeAction.bind(null, key, committee.id)} ask={t('committee.delete.ask')} confirm={t('committee.delete.confirm', { name: committee.name })} cancel={t('committee.delete.cancel')} />
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
