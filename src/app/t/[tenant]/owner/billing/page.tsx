import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { LIMITS, meter, money, type Plan, type Usage } from '@/billing/plans';
import { listInvoices, stripeConfigured, type Invoice } from '@/billing/stripe';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { localize, type MessageKey } from '@/messages';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { cancelAction, choosePlanAction, portalAction, resumeAction } from './actions';
import { regional } from '@/i18n/regional';

// Owner → Billing: the plan, how much of it is used, choosing or changing plans, payment details
// and invoices (on Stripe's own pages), and cancelling, with the export offered first.

interface State {
  metered: boolean;
  plan: string | null;
  status: string;
  billing_status: string | null;
  limits: Record<string, number | null>;
  usage: Usage;
  trial_ends_at: string | null;
  grace_until: string | null;
  pass_until: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  scheduled_plan_key: string | null;
  organisation: boolean | null;
  has_customer: boolean | null;
  has_subscription: boolean | null;
}

const DONE: Record<string, MessageKey> = { paid: 'billing.done.paid', upgraded: 'billing.done.upgraded', scheduled: 'billing.done.scheduled', cancelled: 'billing.done.cancelled', resumed: 'billing.done.resumed' };
const TONE = { ok: 'bg-success', near: 'bg-warning-soft', full: 'bg-danger', unlimited: 'bg-success' } as const;

export default async function BillingPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string; currency?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const s = (await rpc<State | null>('billing_state', { p_tenant: tenant.id }, { token: ctx.token }))!;
  const plans = await rpc<Plan[]>('plans_public', {}, { token: ctx.token });
  const { done, currency: wanted } = await searchParams;
  const currency = wanted === 'usd' || wanted === 'mxn' ? wanted : locale.startsWith('es') ? 'mxn' : 'usd';
  const configured = stripeConfigured();
  const billing = s.has_customer && configured ? await rpc<{ customer: string | null }>('billing_server_get', { p_tenant: tenant.id }, 'service').catch(() => null) : null;
  const invoices: Invoice[] = billing?.customer ? await listInvoices(billing.customer).catch(() => []) : [];
  const date = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'long', timeZone: config.identity.timeZone });
  const d = (iso: string | null) => (iso ? date.format(new Date(iso)) : '—');
  const current = plans.find((p) => p.key === s.plan);
  const name = (p: Plan | undefined) => (p ? localize(p.name, locale, p.key) : t('billing.noPlan'));

  // One sentence for where the school stands.
  const standing = !s.metered
    ? t('billing.status.unmetered')
    : s.status === 'read_only'
      ? t('billing.status.readOnly')
      : s.billing_status === 'pass'
        ? t('billing.status.pass', { date: d(s.pass_until) })
        : s.status === 'trialing'
          ? t('billing.status.trial', { date: d(s.trial_ends_at) })
          : s.status === 'past_due'
            ? t('billing.status.pastDue', { date: d(s.grace_until) })
            : s.cancel_at_period_end
              ? t('billing.status.cancelling', { date: d(s.current_period_end) })
              : t('billing.status.active', { date: d(s.current_period_end) });

  return (
    <Shell title={t('billing.title')} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="billing" />
      <div className="flex flex-col gap-6">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!)}
          </p>
        ) : null}
        {!configured ? <p className="card text-sm">{t('billing.error.unconfigured')}</p> : null}

        <section className="card flex flex-col gap-2" aria-labelledby="plan-now">
          <h2 id="plan-now" className="text-lg font-bold text-on-surface">
            {t('billing.current', { plan: name(current) })}
          </h2>
          <p className={s.status === 'read_only' || s.status === 'past_due' ? 'font-semibold text-danger' : 'text-sm'}>{standing}</p>
          {s.scheduled_plan_key ? <p className="text-sm">{t('billing.scheduled', { plan: name(plans.find((p) => p.key === s.scheduled_plan_key)), date: d(s.current_period_end) })}</p> : null}
          {s.organisation ? <p className="text-sm">{t('billing.organisation')}</p> : null}
        </section>

        {s.metered ? (
          <section className="card flex flex-col gap-3" aria-labelledby="usage">
            <h2 id="usage" className="text-lg font-bold text-on-surface">
              {t('billing.usage')}
            </h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {LIMITS.map((k) => {
                const m = meter(s.usage[k], s.limits[k]);
                return (
                  <li key={k} className="flex flex-col gap-1">
                    <span className="flex justify-between text-sm">
                      <span className="font-semibold text-on-surface">{t(`billing.limitName.${k}` as MessageKey)}</span>
                      <span>{m.level === 'unlimited' ? t('billing.unlimitedOf', { used: s.usage[k] }) : t('billing.usedOf', { used: s.usage[k], max: s.limits[k]! })}</span>
                    </span>
                    {m.level !== 'unlimited' ? (
                      <span className="h-2 w-full overflow-hidden rounded-control bg-surface-raised" aria-hidden="true">
                        <span className={`block h-2 ${TONE[m.level]}`} style={{ width: `${m.percent}%` }} />
                      </span>
                    ) : null}
                    {m.level === 'near' ? <span className="text-xs">{t('billing.near')}</span> : null}
                    {m.level === 'full' ? <span className="text-xs font-semibold text-danger">{t('billing.full')}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {!s.organisation ? (
          <section className="flex flex-col gap-3" aria-labelledby="plans">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="plans" className="text-lg font-bold text-on-surface">
                {t('billing.plans')}
              </h2>
              <nav aria-label={t('billing.currency')} className="flex gap-1">
                {(['mxn', 'usd'] as const).map((c) => (
                  <a key={c} href={`${base}/owner/billing?currency=${c}`} className="chip" aria-current={c === currency ? 'page' : undefined}>
                    {c.toUpperCase()}
                  </a>
                ))}
              </nav>
            </div>
            <p className="text-sm">{t('billing.plansHelp')}</p>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {plans.map((p) => (
                <li key={p.key} className={`card flex flex-col gap-2 ${p.key === s.plan ? 'border-border-strong' : ''}`} aria-label={localize(p.name, locale, p.key)}>
                  <span className="text-lg font-bold text-on-surface">{localize(p.name, locale, p.key)}</span>
                  <span className="text-sm">{localize(p.description, locale, '')}</span>
                  <ul className="text-xs">
                    {LIMITS.map((k) => (
                      <li key={k}>{t('billing.planLimit', { what: t(`billing.limitName.${k}` as MessageKey), max: p.limits[k] ?? t('billing.unlimited') })}</li>
                    ))}
                  </ul>
                  <div className="mt-auto flex flex-col gap-2">
                    {p.prices
                      .filter((x) => x.currency === currency)
                      .map((x) => (
                        <ActionForm key={x.key} action={choosePlanAction.bind(null, key, p.key, x.key) as (st: unknown, f: FormData) => Promise<{ error?: string }>} submitLabel={t(`billing.choose.${x.interval}` as MessageKey, { price: money(x.amount, x.currency, locale) })} variant={p.key === s.plan ? 'secondary' : 'primary'} />
                      ))}
                    {p.per_school ? <span className="text-xs">{t('billing.perSchool')}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card flex flex-col gap-3" aria-labelledby="payment">
          <h2 id="payment" className="text-lg font-bold text-on-surface">
            {t('billing.payment')}
          </h2>
          <p className="text-sm">{t('billing.paymentHelp')}</p>
          {s.has_customer ? <ActionForm action={portalAction.bind(null, key) as (st: unknown, f: FormData) => Promise<{ error?: string }>} submitLabel={t('billing.portal')} variant="secondary" /> : null}
          {invoices.length ? (
            <table className="table text-sm" aria-label={t('billing.invoices')}>
              <thead>
                <tr>
                  <th>{t('billing.invoice.date')}</th>
                  <th>{t('billing.invoice.number')}</th>
                  <th>{t('billing.invoice.amount')}</th>
                  <th>{t('billing.invoice.status')}</th>
                  <th>{t('billing.invoice.open')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{date.format(new Date(i.created * 1000))}</td>
                    <td className="font-mono">{i.number ?? '—'}</td>
                    <td>{money(i.status === 'paid' ? i.amount_paid : i.amount_due, i.currency, locale)}</td>
                    <td>{t(`billing.invoice.${i.status === 'paid' ? 'paid' : i.status === 'open' ? 'open_' : 'other'}` as MessageKey)}</td>
                    <td>
                      {i.hosted_invoice_url ? (
                        <a className="underline underline-offset-2" href={i.hosted_invoice_url}>
                          {t('billing.invoice.view')}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm">{t('billing.invoice.none')}</p>
          )}
        </section>

        {s.has_subscription && s.billing_status !== 'canceled' ? (
          <section className="card flex flex-col gap-3" aria-labelledby="cancel">
            <h2 id="cancel" className="text-lg font-bold text-on-surface">
              {t('billing.cancel.title')}
            </h2>
            {s.cancel_at_period_end ? (
              <ConfirmButton action={resumeAction.bind(null, key)} ask={t('billing.cancel.resume')} confirm={t('billing.cancel.resumeConfirm')} cancel={t('billing.cancel.keep')} />
            ) : (
              <>
                <p className="text-sm">{t('billing.cancel.help', { date: d(s.current_period_end) })}</p>
                <p>
                  <a className="btn btn-secondary" href={`${base}/owner/data`}>
                    {t('billing.cancel.exportFirst')}
                  </a>
                </p>
                <ActionForm action={cancelAction.bind(null, key, true)} submitLabel={t('billing.cancel.submit')} variant="secondary">
                  <label className="flex flex-col gap-1">
                    <span className="label">{t('billing.cancel.confirm', { name: tenant.name })}</span>
                    <input className="input" name="confirm" required autoComplete="off" />
                  </label>
                </ActionForm>
              </>
            )}
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
