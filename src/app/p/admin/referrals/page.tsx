import { AdminShell } from '@/app/p/admin/AdminShell';
import { ActionForm } from '@/components/ActionForm';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { basePath } from '@/tenancy/context';
import { referralAction, referralActiveAction } from '../actions';

// Admin → Referrals: partners who bring schools (a circuit, a consultant, a teacher network). Each
// has a link; schools that sign up through it are the partner's, and its discount is applied when
// they first pay, without typing anything.

interface Referral {
  code: string;
  name: string;
  percent_off: number;
  duration_months: number | null;
  active: boolean;
  stripe_promotion_code_id: string | null;
  signups: number;
  paying: number;
  schools: { id: string; slug: string; name: string; billing_status: string | null; plan: string | null }[];
}

export default async function AdminReferrals({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const base = await basePath();
  const referrals = await rpc<Referral[]>('platform_referrals', {}, a);
  const { done } = await searchParams;
  const site = `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;
  const discount = (r: Referral) =>
    !r.percent_off ? t('platform.referrals.noDiscount') : r.duration_months ? t('platform.referrals.discountMonths', { percent: r.percent_off, months: r.duration_months }) : t('platform.referrals.discountOnce', { percent: r.percent_off });

  return (
    <AdminShell title={t('platform.referrals.title')} intro={t('platform.referrals.intro')}>
      {done ? (
        <p role="status" className="card font-semibold text-on-surface">
          {t(`platform.referrals.done.${done}` as MessageKey)}
        </p>
      ) : null}
      <ol className="card flex list-decimal flex-col gap-1 ps-9 text-sm">
        <li>{t('platform.referrals.how1')}</li>
        <li>{t('platform.referrals.how2')}</li>
        <li>{t('platform.referrals.how3')}</li>
      </ol>

      <section className="card flex flex-col gap-3" aria-labelledby="partners">
        <h2 id="partners" className="text-lg font-bold text-on-surface">
          {t('platform.referrals.partners')}
        </h2>
        {referrals.length ? (
          <div className="overflow-x-auto">
            <table className="table text-sm" aria-labelledby="partners">
              <thead>
                <tr>
                  <th scope="col">{t('platform.billing.partner')}</th>
                  <th scope="col">{t('platform.referrals.link')}</th>
                  <th scope="col">{t('platform.billing.discount')}</th>
                  <th scope="col" className="num">{t('platform.referrals.signups')}</th>
                  <th scope="col" className="num">{t('platform.billing.schools')}</th>
                  <th scope="col" className="num">{t('platform.billing.paying')}</th>
                  <th scope="col">{t('platform.referrals.state')}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <span className="block font-semibold text-on-surface">{r.name}</span>
                      {r.schools.length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs">{t('platform.referrals.showSchools')}</summary>
                          <ul className="mt-1 flex flex-col gap-1 text-xs">
                            {r.schools.map((x) => (
                              <li key={x.id}>
                                <a className="underline underline-offset-2" href={`${base}/tenants/${x.id}`}>
                                  {x.name}
                                </a>{' '}
                                · {x.plan ?? '—'} · {x.billing_status ?? '—'}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td>
                      <span className="block font-mono text-xs" translate="no">
                        {`${site}/?ref=${r.code}`}
                      </span>
                      <span className="block text-xs">{t('platform.referrals.code', { code: r.code })}</span>
                    </td>
                    <td>{discount(r)}</td>
                    <td className="num">{r.signups}</td>
                    <td className="num">{r.schools.length}</td>
                    <td className="num">{r.paying}</td>
                    <td>
                      <span className={`badge ${r.active ? 'tone-live' : 'tone-paused'}`}>{t(r.active ? 'platform.referrals.on' : 'platform.referrals.off')}</span>
                      <div className="mt-1">
                        <ActionForm action={referralActiveAction.bind(null, r.code, !r.active)} submitLabel={t(r.active ? 'platform.referrals.turnOff' : 'platform.referrals.turnOn')} variant="secondary" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm">{t('platform.referrals.none')}</p>
        )}
      </section>

      <section className="card flex flex-col gap-3" aria-labelledby="new-partner">
        <h2 id="new-partner" className="text-lg font-bold text-on-surface">
          {t('platform.referrals.new')}
        </h2>
        <ActionForm action={referralAction} submitLabel={t('platform.billing.addReferral')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.billing.partner')}</span>
              <input className="input" name="name" required maxLength={120} autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.billing.code')}</span>
              <input className="input font-mono uppercase" name="code" required pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,29}" autoComplete="off" spellCheck={false} />
              <span className="text-xs">{t('platform.referrals.codeHelp')}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.billing.discountPercent')}</span>
              <input className="input" name="percent_off" type="number" min={0} max={100} defaultValue={10} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.referrals.duration')}</span>
              <select className="input" name="duration_months" defaultValue="">
                <option value="">{t('platform.referrals.durationOnce')}</option>
                {[2, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>
                    {t('platform.referrals.durationMonths', { months: m })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ActionForm>
      </section>
    </AdminShell>
  );
}
