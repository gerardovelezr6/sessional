import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { readCheckinCode } from '@/print/checkin';
import { protocolFor } from '@/protocol/run';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadCommittee } from '../../committees/data';
import { checkInAction } from './actions';

// Where a placard's QR code leads. Opening it changes nothing: a signed-in chair of the committee
// picks the attendance and presses the button. Anyone else is told they cannot.
export default async function CheckInPage({ params, searchParams }: { params: Promise<{ tenant: string; code: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key, code } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const target = readCheckinCode(decodeURIComponent(code));
  if (!target) return <Notice title={t('checkin.invalid')} body={t('checkin.invalid.body')} locale={locale} />;
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  const detail = ctx.can('committee.run') || ctx.can('committee.manage') ? await loadCommittee(tenant.id, target.committee, ctx.token) : null;
  const delegate = detail?.delegates.find((d) => d.id === target.delegate);
  if (!detail || !delegate) return <Notice title={t('checkin.forbidden')} body={t('checkin.forbidden.body')} locale={locale} />;
  const states = protocolFor(null, config.protocol).attendance;
  const { done } = await searchParams;
  const doneState = states.find((s) => s.key === done);

  return (
    <Shell title={t('checkin.title', { delegation: delegate.label })} locale={locale}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{detail.committee.abbreviation ? `${detail.committee.abbreviation} · ${detail.committee.name}` : detail.committee.name}</p>
        {doneState ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('checkin.done', { delegation: delegate.label, state: localize(doneState.name, locale, doneState.key) })}
          </p>
        ) : null}
        {states.map((s) => (
          <ActionForm key={s.key} action={checkInAction.bind(null, key, decodeURIComponent(code))} submitLabel={t('checkin.mark', { state: localize(s.name, locale, s.key) })} variant={s.countsForQuorum ? 'primary' : 'secondary'}>
            <input type="hidden" name="state" value={s.key} />
          </ActionForm>
        ))}
        <p>
          <a className="text-sm font-semibold underline underline-offset-2" href={`${base}/committees/${detail.committee.id}/console`}>
            {t('checkin.console')}
          </a>
        </p>
      </div>
    </Shell>
  );
}
