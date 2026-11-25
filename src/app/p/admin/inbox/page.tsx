import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Shell } from '@/components/Shell';
import { rpc } from '@/data/rpc';
import { countryName } from '@/i18n/countries';
import { regional } from '@/i18n/regional';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { contactStatusAction, deleteContactAction } from '../actions';

// Admin → Inbox: what people asked through the website's contact form, newest first. Each request
// is kept for 180 days. Replying is done from your own email, to the address they gave.
interface Row {
  id: string;
  created_at: string;
  name: string;
  email: string;
  role: 'staff' | 'student' | 'other';
  organization: string;
  country: string | null;
  conference: string | null;
  month: string | null;
  committees: number | null;
  delegates: number | null;
  language: 'en' | 'es';
  message: string | null;
  emailed: boolean;
  status: 'new' | 'answered';
}

export default async function AdminInbox({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const list = await rpc<Row[]>('platform_contact_list', {}, a);
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(regional(DEFAULT_LOCALE), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(regional(DEFAULT_LOCALE), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const waiting = list.filter((r) => r.status === 'new').length;
  return (
    <Shell title={t('platform.inbox.title')} size="full">
      <div className="flex max-w-4xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('platform.done.contact')}
          </p>
        ) : null}
        <p className="text-sm">{t('platform.inbox.help', { count: waiting })}</p>
        {list.length === 0 ? <p className="card">{t('platform.inbox.empty')}</p> : null}
        <ul className="flex flex-col gap-3" aria-label={t('platform.inbox.title')}>
          {list.map((r) => (
            <li key={r.id} className="card flex flex-col gap-2">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-on-surface">
                  {r.name} · {r.organization}
                </span>
                <span className="text-xs">
                  {when.format(new Date(r.created_at))} · {t(r.status === 'new' ? 'platform.inbox.new' : 'platform.inbox.answered')}
                  {r.emailed ? ` · ${t('platform.inbox.emailed')}` : ''}
                </span>
              </span>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="font-semibold">{t('contact.field.email')}</dt>
                  <dd>
                    <a className="underline" href={`mailto:${r.email}`}>
                      {r.email}
                    </a>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold">{t('contact.field.role')}</dt>
                  <dd>{t(`contact.role.${r.role}`)}</dd>
                </div>
                {r.country ? (
                  <div className="flex gap-2">
                    <dt className="font-semibold">{t('contact.field.country')}</dt>
                    <dd>{countryName(r.country, DEFAULT_LOCALE)}</dd>
                  </div>
                ) : null}
                {r.conference ? (
                  <div className="flex gap-2">
                    <dt className="font-semibold">{t('contact.field.conference')}</dt>
                    <dd>{r.conference}</dd>
                  </div>
                ) : null}
                {r.month ? (
                  <div className="flex gap-2">
                    <dt className="font-semibold">{t('contact.field.month')}</dt>
                    <dd>{month.format(new Date(`${r.month}-15T12:00:00Z`))}</dd>
                  </div>
                ) : null}
                {r.committees || r.delegates ? (
                  <div className="flex gap-2">
                    <dt className="font-semibold">{t('platform.inbox.size')}</dt>
                    <dd>{t('platform.inbox.sizeValue', { committees: r.committees ?? '—', delegates: r.delegates ?? '—' })}</dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="font-semibold">{t('contact.field.language')}</dt>
                  <dd>{t(`contact.language.${r.language}`)}</dd>
                </div>
              </dl>
              {r.message ? <p className="whitespace-pre-line break-words text-sm">{r.message}</p> : null}
              <span className="flex flex-wrap gap-2">
                <ActionForm action={contactStatusAction.bind(null, r.id, r.status === 'new' ? 'answered' : 'new')} submitLabel={t(r.status === 'new' ? 'platform.inbox.markAnswered' : 'platform.inbox.markNew')} variant="secondary" />
                <ConfirmButton action={deleteContactAction.bind(null, r.id)} ask={t('platform.inbox.delete')} confirm={t('platform.inbox.deleteConfirm')} cancel={t('platform.school.keep')} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}
