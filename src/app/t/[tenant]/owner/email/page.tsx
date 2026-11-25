import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantConfig, tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { assetUrl } from '@/data/storage';
import type { MessageKey } from '@/messages';
import { mailConfigured } from '@/platform/mail';
import { composeEmail, EMAIL_KINDS } from '@/platform/school-mail';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext, tenantOrigin } from '@/tenancy/context';
import { checkSenderAction, removeSenderAction, setSenderAction, testEmailAction } from './actions';

// Owner → Email: which emails the school sends and how they read (each one previewed with the
// school's current words and look), who they come from, and a test sent to yourself.

interface Sender {
  domain: string;
  local_part: string;
  records: { type: string; name: string; value: string; found?: string[]; ok?: boolean }[];
  status: 'pending' | 'verified' | 'error';
  problem: string | null;
}

export default async function EmailPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string; kind?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const [sender, features, config] = await Promise.all([
    rpc<Sender | null>('mail_sender_get', { p_tenant: tenant.id }, { token: ctx.token }),
    rpc<{ own_sender: boolean } | null>('tenant_features', { p_tenant: tenant.id }, { token: ctx.token }),
    tenantConfig(tenant.id),
  ]);
  const { done, kind: asked } = await searchParams;
  const kind = (EMAIL_KINDS as readonly string[]).includes(asked ?? '') ? (asked as (typeof EMAIL_KINDS)[number]) : 'invite';
  const sample = composeEmail(config, kind, locale, { name: ctx.user.fullName || ctx.user.email, school: tenant.name, role: t('mail.test.role'), link: `${await tenantOrigin()}/login` }, assetUrl(tenant.id, config.theme.logo));

  return (
    <Shell title={t('mail.title')} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="overview" />
      <div className="flex max-w-5xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(`mail.done.${done}` as MessageKey)}
          </p>
        ) : null}
        {!mailConfigured() ? <p className="card">{t('mail.unavailable')}</p> : null}

        <section className="card flex flex-col gap-3" aria-labelledby="mail-words">
          <h2 id="mail-words" className="text-lg font-bold text-on-surface">
            {t('mail.words.title')}
          </h2>
          <p className="text-sm">{t('mail.words.body')}</p>
          <nav aria-label={t('mail.words.which')} className="flex flex-wrap gap-2">
            {EMAIL_KINDS.map((k) => (
              <a key={k} href={`${base}/owner/email?kind=${k}`} aria-current={k === kind ? 'page' : undefined} className={`btn btn-sm ${k === kind ? 'btn-primary' : 'btn-secondary'}`}>
                {t(`mail.kind.${k}`)}
              </a>
            ))}
          </nav>
          <p className="text-sm">
            <span className="font-semibold text-on-surface">{t('mail.subject')}:</span> {sample.subject}
          </p>
          <iframe title={t('mail.preview')} srcDoc={sample.html} sandbox="" className="h-[28rem] w-full border border-border bg-surface" />
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-secondary" href={`${base}/settings?section=email`}>
              {t('mail.words.edit')}
            </a>
            {mailConfigured() ? <ActionForm action={testEmailAction.bind(null, key)} submitLabel={t('mail.test.send', { email: ctx.user.email })} variant="secondary" /> : null}
          </div>
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="mail-sender">
          <h2 id="mail-sender" className="text-lg font-bold text-on-surface">
            {t('mail.sender.title')}
          </h2>
          <p className="text-sm">{sender?.status === 'verified' ? t('mail.sender.using', { address: `${sender.local_part}@${sender.domain}` }) : t('mail.sender.default')}</p>
          {!features?.own_sender ? (
            <p className="text-sm">
              {t('mail.sender.plan')}{' '}
              <a className="font-semibold underline underline-offset-2" href={`${base}/owner/billing`}>
                {t('domains.planLink')}
              </a>
            </p>
          ) : (
            <ActionForm action={setSenderAction.bind(null, key)} submitLabel={t(sender ? 'mail.sender.change' : 'mail.sender.set')}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="label">{t('mail.sender.local')}</span>
                  <input className="input w-40 font-mono" name="local" defaultValue={sender?.local_part ?? 'conference'} maxLength={64} autoComplete="off" spellCheck={false} />
                </label>
                <span className="pb-2 font-mono" aria-hidden="true">
                  @
                </span>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('mail.sender.domain')}</span>
                  <input className="input w-64 font-mono" name="domain" required defaultValue={sender?.domain ?? ''} placeholder={t('mail.sender.domainExample')} maxLength={253} autoComplete="off" spellCheck={false} inputMode="url" />
                </label>
              </div>
            </ActionForm>
          )}
          {sender ? (
            <>
              <p className="text-sm">
                <span className={`badge ${sender.status === 'verified' ? 'tone-live' : sender.status === 'error' ? 'tone-danger' : 'tone-paused'}`}>{t(`domains.status.${sender.status}`)}</span>{' '}
                {sender.status === 'verified' ? null : t('mail.sender.records')}
              </p>
              {sender.records.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <caption className="sr-only">{t('domains.records')}</caption>
                    <thead>
                      <tr className="border-b border-border-strong">
                        {(['type', 'name', 'value', 'found', 'ok'] as const).map((c) => (
                          <th key={c} scope="col" className="label-text p-2 text-start">
                            {t(`domains.col.${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sender.records.map((r) => (
                        <tr key={`${r.type}-${r.name}`} className="border-b border-border align-top">
                          <td className="p-2 font-mono">{r.type}</td>
                          <td className="p-2 font-mono break-all" translate="no">
                            {r.name}
                          </td>
                          <td className="max-w-xs p-2 font-mono break-all" translate="no">
                            {r.value}
                          </td>
                          <td className="max-w-xs p-2 font-mono break-all" translate="no">
                            {r.found?.length ? r.found.join(', ') : t('domains.nothing')}
                          </td>
                          <td className="p-2 font-semibold text-on-surface">{t(r.ok ? 'domains.match' : 'domains.noMatch')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <ActionForm action={checkSenderAction.bind(null, key)} submitLabel={t('domains.check')} variant="secondary" />
                <ConfirmButton action={removeSenderAction.bind(null, key)} ask={t('mail.sender.remove')} confirm={t('mail.sender.removeConfirm')} cancel={t('platform.school.keep')} />
              </div>
            </>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
