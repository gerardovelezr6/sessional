import { AdminShell } from '@/app/p/admin/AdminShell';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { basePath } from '@/tenancy/context';
import { findPersonAction } from '../actions';
import { SupportSearch } from './SupportSearch';

// Admin → Support: find a person by their exact email address and the schools they belong to.
// There is no browsing of people; the address is never in a URL or a log.
export default async function AdminSupport() {
  const t = translator(DEFAULT_LOCALE);
  await requireAdmin();
  const base = await basePath();
  const statuses = ['trialing', 'active', 'past_due', 'read_only', 'suspended', 'deleted'];
  const L = {
    email: t('platform.support.email'),
    find: t('platform.schools.find'),
    none: t('platform.support.none'),
    result: t('platform.support.result'),
    since: t('platform.support.since'),
    admin: t('platform.support.admin'),
    noSchools: t('platform.support.noSchools'),
    active: t('platform.member.active'),
    invited: t('platform.member.invited'),
    ...Object.fromEntries(statuses.map((s) => [`status_${s}`, t(`platform.status.${s}` as MessageKey)])),
  };
  return (
    <AdminShell title={t('platform.support.title')}>
      <div className="flex flex-col gap-5">
        <p className="text-sm">{t('platform.support.help')}</p>
        <SupportSearch find={findPersonAction} base={base} L={L} />
      </div>
    </AdminShell>
  );
}
