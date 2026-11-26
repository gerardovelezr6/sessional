import { ActionForm } from '@/components/ActionForm';
import { AdminShell } from '@/app/p/admin/AdminShell';
import { stripeConfigured } from '@/billing/stripe';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { savePlanAction, syncPricesAction } from '../actions';

// Admin → Plans: every plan is data. Limits (empty: unlimited), features, prices per currency and
// interval, and their Stripe prices, created from here.
interface PlanRow {
  key: string;
  name: Record<string, string>;
  description: Record<string, string>;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
  prices: { key: string; interval: string; currency: string; amount: number; stripe_price_id?: string | null; retired?: boolean }[];
  per_school: boolean;
  public: boolean;
  sort: number;
  terms: { months: number; percent_off: number }[];
  volume: { from: number; percent_off: number }[];
}
const LIMIT_KEYS = ['committees', 'delegates', 'staff', 'active_conferences', 'storage_mb'] as const;
const FEATURE_KEYS = ['custom_domain', 'own_sender', 'white_label', 'sso', 'legal_pages', 'organisation'] as const;
const pad = <T,>(list: T[], n: number, empty: T) => [...list, ...Array.from({ length: Math.max(0, n - list.length) }, () => empty)];

export default async function AdminPlans({ searchParams }: { searchParams: Promise<{ done?: string; n?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const plans = await rpc<PlanRow[]>('platform_plans', {}, a);
  const { done, n } = await searchParams;
  const missing = plans.reduce((m, p) => m + p.prices.filter((x) => !x.stripe_price_id).length, 0);
  return (
    <AdminShell title={t('platform.plans.title')}>
      <div className="flex flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {done === 'synced' ? t('platform.plans.synced', { count: Number(n) || 0 }) : t('platform.plans.saved')}
          </p>
        ) : null}
        <p className="max-w-3xl text-sm">{t('platform.plans.help')}</p>
        <section className="card flex flex-col gap-2" aria-labelledby="sync">
          <h2 id="sync" className="text-lg font-bold text-on-surface">
            {t('platform.plans.stripe')}
          </h2>
          <p className="text-sm">{stripeConfigured() ? t('platform.plans.missing', { count: missing }) : t('billing.error.unconfigured')}</p>
          {stripeConfigured() && missing ? <ActionForm action={syncPricesAction as (s: unknown, f: FormData) => Promise<{ error?: string }>} submitLabel={t('platform.plans.sync')} variant="secondary" /> : null}
        </section>
        {plans.map((p) => (
          <details key={p.key} className="card">
            <summary className="cursor-pointer text-lg font-bold text-on-surface">{`${p.name.en ?? p.key} · ${p.key}${p.public ? '' : ` · ${t('platform.plans.hidden')}`}`}</summary>
            <div className="mt-3">
              <ActionForm action={savePlanAction.bind(null, p.key)} submitLabel={t('platform.plans.save')}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {(['en', 'es'] as const).map((l) => (
                    <label key={`n${l}`} className="flex flex-col gap-1">
                      <span className="label">{t(`platform.presets.name${l === 'en' ? 'En' : 'Es'}` as MessageKey)}</span>
                      <input className="input" name={`name_${l}`} defaultValue={p.name[l] ?? ''} maxLength={60} />
                    </label>
                  ))}
                  {(['en', 'es'] as const).map((l) => (
                    <label key={`d${l}`} className="flex flex-col gap-1">
                      <span className="label">{t(`platform.presets.description${l === 'en' ? 'En' : 'Es'}` as MessageKey)}</span>
                      <input className="input" name={`description_${l}`} defaultValue={p.description[l] ?? ''} maxLength={200} />
                    </label>
                  ))}
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="label">{t('platform.plans.limits')}</legend>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    {LIMIT_KEYS.map((k) => (
                      <label key={k} className="flex flex-col gap-1">
                        <span className="label">{t(`platform.plans.limit.${k}` as MessageKey)}</span>
                        <input className="input" name={`limit_${k}`} inputMode="numeric" defaultValue={p.limits[k] ?? ''} placeholder={t('billing.unlimited')} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="label">{t('platform.plans.features')}</legend>
                  {FEATURE_KEYS.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="checkbox" name={`feature_${k}`} defaultChecked={!!p.features[k]} />
                      {t(`platform.plans.feature.${k}` as MessageKey)}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="label">{t('platform.plans.prices')}</legend>
                  {[...p.prices, { key: 'new', interval: '', currency: '', amount: 0, stripe_price_id: null }].map((x, i) => (
                    <div key={`${x.key}-${i}`} className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="label">{t('platform.plans.interval')}</span>
                        <select className="input w-auto" name={`price_${i}_interval`} defaultValue={x.interval}>
                          <option value="">—</option>
                          <option value="month">{t('platform.plans.interval.month')}</option>
                          <option value="year">{t('platform.plans.interval.year')}</option>
                          <option value="conference">{t('platform.plans.interval.conference')}</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label">{t('platform.plans.currency')}</span>
                        <select className="input w-auto" name={`price_${i}_currency`} defaultValue={x.currency}>
                          <option value="">—</option>
                          <option value="mxn">{"mxn".toUpperCase()}</option>
                          <option value="usd">{"usd".toUpperCase()}</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label">{t('platform.plans.amount')}</span>
                        <input className="input w-32" name={`price_${i}_amount`} inputMode="decimal" defaultValue={x.amount ? (x.amount / 100).toFixed(2) : ''} />
                      </label>
                      {x.key === 'new' ? null : (
                        <label className="flex items-center gap-2 pb-2 text-sm">
                          <input type="checkbox" className="checkbox" name={`price_${i}_offered`} defaultChecked={!x.retired} />
                          {t('platform.plans.offered')}
                        </label>
                      )}
                      <span className="pb-2 font-mono text-xs">{x.key === 'new' ? '' : (x.stripe_price_id ?? t('platform.plans.notInStripe'))}</span>
                    </div>
                  ))}
                  <p className="text-xs">{t('platform.plans.offeredHelp')}</p>
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="label">{t('platform.plans.terms')}</legend>
                  <p className="text-xs">{t('platform.plans.termsHelp')}</p>
                  {pad(p.terms ?? [], 3, { months: 0, percent_off: 0 }).map((x, i) => (
                    <div key={`term-${i}`} className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="label">{t('platform.plans.termMonths')}</span>
                        <input className="input w-24" name={`term_${i}_months`} inputMode="numeric" defaultValue={x.months || ''} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label">{t('platform.plans.percentOff')}</span>
                        <input className="input w-24" name={`term_${i}_percent`} inputMode="numeric" defaultValue={x.percent_off || ''} />
                      </label>
                    </div>
                  ))}
                </fieldset>
                {p.per_school ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="label">{t('platform.plans.volume')}</legend>
                    <p className="text-xs">{t('platform.plans.volumeHelp')}</p>
                    {pad(p.volume ?? [], 3, { from: 0, percent_off: 0 }).map((x, i) => (
                      <div key={`vol-${i}`} className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="label">{t('platform.plans.volumeFrom')}</span>
                          <input className="input w-24" name={`volume_${i}_from`} inputMode="numeric" defaultValue={x.from || ''} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="label">{t('platform.plans.percentOff')}</span>
                          <input className="input w-24" name={`volume_${i}_percent`} inputMode="numeric" defaultValue={x.percent_off || ''} />
                        </label>
                      </div>
                    ))}
                  </fieldset>
                ) : null}
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="checkbox" name="public" defaultChecked={p.public} />
                    {t('platform.plans.public')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="checkbox" name="per_school" defaultChecked={p.per_school} />
                    {t('platform.plans.perSchool')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    {t('platform.plans.sort')}
                    <input className="input w-20" name="sort" inputMode="numeric" defaultValue={p.sort} />
                  </label>
                </div>
              </ActionForm>
            </div>
          </details>
        ))}
      </div>
    </AdminShell>
  );
}
