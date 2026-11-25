import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { timeZoneGroups } from '@/i18n/time-zones';
import type { MessageKey } from '@/messages';
import { PROTOCOL_PRESET_KEYS } from '@/protocol/presets';
import { TERM_PACK_KEYS } from '@/i18n/terms';
import { PRESET_KEYS, PRESETS } from '@/theme/presets';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { conferenceStepAction, lookStepAction, rulesStepAction, startStepAction } from './actions';

// The setup wizard a new school's Owner lands in after signing up: four short steps, each saved
// as it is left, all changeable later in Settings. The step is in the address, so Back works.
const STEPS = ['conference', 'look', 'rules', 'start'] as const;
type Step = (typeof STEPS)[number];

export default async function Welcome({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ step?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) redirect(`${base}/`);
  const { t, config, locale } = await tenantTranslator(tenant.id);
  const asked = (await searchParams).step;
  const step: Step = (STEPS as readonly string[]).includes(asked ?? '') ? (asked as Step) : 'conference';
  const index = STEPS.indexOf(step);
  const conference = step === 'conference' ? (await rpc<{ conference: { name: string } | null }>('committees_overview', { p_tenant: tenant.id }, { token: ctx.token })).conference : null;
  const languages = config.locale.enabledLocales.length === 1 ? config.locale.enabledLocales[0] : 'both';

  return (
    <Shell title={t('welcome.title', { school: tenant.name })} subtitle={t('welcome.subtitle')}>
      <div className="flex flex-col gap-6">
        <nav aria-label={t('welcome.progress')}>
          <ol className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={s === step ? 'step' : undefined} className={`border-t-4 pt-2 ${i <= index ? 'border-primary font-semibold text-on-surface' : 'border-border'}`}>
                {i < index ? (
                  <a className="underline-offset-2 hover:underline" href={`${base}/welcome?step=${s}`}>
                    {t('welcome.stepOf', { n: i + 1, title: t(`welcome.step.${s}` as MessageKey) })}
                  </a>
                ) : (
                  t('welcome.stepOf', { n: i + 1, title: t(`welcome.step.${s}` as MessageKey) })
                )}
              </li>
            ))}
          </ol>
        </nav>

        <section className="card flex flex-col gap-4" aria-labelledby="step-title">
          <h2 id="step-title" className="text-xl font-bold text-on-surface">
            {t(`welcome.step.${step}.title` as MessageKey)}
          </h2>
          <p className="text-sm">{t(`welcome.step.${step}.help` as MessageKey)}</p>

          {step === 'conference' ? (
            <ActionForm action={conferenceStepAction.bind(null, key)} submitLabel={t('welcome.next')}>
              <label className="flex flex-col gap-1">
                <span className="label">{t('welcome.field.conference')}</span>
                <input className="input" name="conference" required maxLength={120} defaultValue={conference?.name ?? tenant.name} />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="label">{t('welcome.field.dates')}</span>
                  <input className="input" name="dates" maxLength={120} placeholder={t('welcome.field.datesExample')} defaultValue={config.identity.dates[locale] ?? ''} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('welcome.field.venue')}</span>
                  <input className="input" name="venue" maxLength={120} placeholder={t('welcome.field.venueExample')} defaultValue={config.identity.venue[locale] ?? ''} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="label">{t('settings.identity.timeZone')}</span>
                <select className="input" name="timeZone" defaultValue={config.identity.timeZone}>
                  {timeZoneGroups(locale).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.zones.map((z) => (
                        <option key={z.value} value={z.value}>
                          {z.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <fieldset className="flex flex-col gap-2">
                <legend className="label">{t('welcome.field.languages')}</legend>
                {(['both', 'en', 'es'] as const).map((l) => (
                  <label key={l} className="flex items-center gap-2">
                    <input type="radio" name="languages" value={l} defaultChecked={languages === l} />
                    {t(`welcome.languages.${l}`)}
                  </label>
                ))}
              </fieldset>
            </ActionForm>
          ) : null}

          {step === 'look' ? (
            <ActionForm action={lookStepAction.bind(null, key)} submitLabel={t('welcome.next')}>
              <fieldset className="flex flex-col gap-2">
                <legend className="label">{t('settings.theme.preset')}</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PRESET_KEYS.map((p) => (
                    <label key={p} className="choice-card flex items-center gap-3 border border-border p-3">
                      <input type="radio" name="preset" value={p} defaultChecked={config.theme.preset === p} />
                      <span className="flex shrink-0 overflow-hidden border border-border" aria-hidden="true">
                        {[PRESETS[p].background, PRESETS[p].brand, PRESETS[p].accent].map((c, i) => (
                          <span key={i} className="block h-6 w-6" style={{ background: c }} />
                        ))}
                      </span>
                      <span>{t(`settings.theme.preset.${p}` as MessageKey)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="useBrand" defaultChecked={!!config.theme.brand} />
                {t('welcome.field.useBrand')}
              </label>
              <label className="flex items-center gap-3">
                <span className="label">{t('settings.theme.brand')}</span>
                <input type="color" name="brand" defaultValue={config.theme.brand ?? PRESETS[config.theme.preset].brand} className="h-10 w-16" />
              </label>
              <p className="text-sm">{t('welcome.look.later')}</p>
            </ActionForm>
          ) : null}

          {step === 'rules' ? (
            <ActionForm action={rulesStepAction.bind(null, key)} submitLabel={t('welcome.next')}>
              <fieldset className="flex flex-col gap-2">
                <legend className="label">{t('welcome.field.protocol')}</legend>
                {PROTOCOL_PRESET_KEYS.map((p) => (
                  <label key={p} className="flex items-start gap-2">
                    <input type="radio" name="protocol" value={p} defaultChecked={config.protocol.preset === p} className="mt-1" />
                    <span>
                      <span className="block font-semibold text-on-surface">{t(`settings.protocol.preset.${p}` as MessageKey)}</span>
                      <span className="block text-sm">{t(`settings.protocol.preset.${p}.help` as MessageKey)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="label">{t('welcome.field.pack')}</legend>
                {TERM_PACK_KEYS.map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="radio" name="pack" value={p} defaultChecked={config.terminology.pack === p} />
                    {t(`settings.terminology.pack.${p}` as MessageKey)}
                  </label>
                ))}
              </fieldset>
            </ActionForm>
          ) : null}

          {step === 'start' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {(['demo', 'import', 'empty'] as const).map((how) => (
                <div key={how} className="flex flex-col gap-3 border border-border p-4">
                  <h3 className="font-bold text-on-surface">{t(`welcome.start.${how}.title`)}</h3>
                  <p className="flex-1 text-sm">{t(`welcome.start.${how}.body`)}</p>
                  <ActionForm action={startStepAction.bind(null, key, how)} submitLabel={t(`welcome.start.${how}.button`)} variant={how === 'demo' ? 'primary' : 'secondary'} />
                </div>
              ))}
            </div>
          ) : null}
        </section>
        <p className="text-sm">
          <a className="underline underline-offset-2" href={`${base}/`}>
            {t('welcome.skip')}
          </a>
        </p>
      </div>
    </Shell>
  );
}
