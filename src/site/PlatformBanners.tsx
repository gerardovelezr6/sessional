import { localize, type Translate } from '@/messages';
import { liveAnnouncements } from '@/platform/announcements';
import { currentImpersonation } from '@/platform/impersonation';
import { regional } from '@/i18n/regional';

// Above every school page: a platform admin's session as a member (who, why, until when, and a
// button to end it), and the platform's announcements. Neither can be dismissed.
export async function PlatformBanners({ tenantId, base, locale, t, manager, name }: { tenantId: string; base: string; locale: string; t: Translate; manager: boolean; name: string | null }) {
  const imp = await currentImpersonation();
  const announcements = (await liveAnnouncements()).filter((a) => a.audience === 'all' || manager);
  const until = imp ? new Intl.DateTimeFormat(regional(locale), { timeStyle: 'short' }).format(new Date(imp.expires_at)) : '';
  return (
    <>
      {imp ? (
        <div role="alert" className="sticky top-0 z-30 flex flex-wrap items-center justify-center gap-3 bg-danger px-4 py-2 text-center text-sm font-semibold text-on-danger">
          <span>
            {imp.active && imp.tenant_id === tenantId
              ? t('impersonation.banner', { admin: imp.admin, name: name ?? '', until, reason: imp.reason })
              : t('impersonation.ended')}
          </span>
          <form method="post" action={`${base}/auth/impersonate/end`}>
            <button type="submit" className="btn btn-secondary">
              {t(imp.active ? 'impersonation.end' : 'impersonation.signOut')}
            </button>
          </form>
        </div>
      ) : null}
      {announcements.map((a) => {
        const text = localize(a.message, locale, '');
        return text ? (
          // Not a live region: it is there when the page loads, not news about something just done.
          <aside key={a.id} aria-label={t('platformAnnouncement.label')} className={`px-4 py-2 text-center text-sm font-semibold ${a.tone === 'warning' ? 'bg-warning-soft text-on-warning-soft' : 'bg-accent text-on-accent'}`}>
            {text}
          </aside>
        ) : null;
      })}
    </>
  );
}
