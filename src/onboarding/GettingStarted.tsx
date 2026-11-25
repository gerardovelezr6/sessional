import { tourSeenAction } from '@/app/t/[tenant]/onboarding-actions';
import { rpc } from '@/data/rpc';
import type { MessageKey, Translate } from '@/messages';
import { Tour } from '@/site/Tour';
import type { TenantContext } from '@/tenancy/context';
import { TOURS, tourFor } from './tours';

// What a new school, or a person new to it, sees at the top of the home page: a reminder to finish
// setting up, a note after the demo was loaded, and the tour for what this person can do.
export async function GettingStarted({ t, base, ctx, tenantId, tenantKey, firstCommittee, welcome }: { t: Translate; base: string; ctx: TenantContext; tenantId: string; tenantKey: string; firstCommittee: string | null; welcome?: string }) {
  const state = await rpc<{ setup_completed_at: string | null; tours_seen: string[] } | null>('onboarding_state', { p_tenant: tenantId }, { token: ctx.token }).catch(() => null);
  if (!state) return null;
  const tour = tourFor(ctx.can);
  const path = (key: string, fallback: string) =>
    key === 'console' && firstCommittee ? `/committees/${firstCommittee}/console` : key === 'yourCommittee' && firstCommittee ? `/committees/${firstCommittee}` : fallback;
  const steps = TOURS[tour].map((s) => ({ title: t(`tour.${tour}.${s.key}.title` as MessageKey), body: t(`tour.${tour}.${s.key}.body` as MessageKey), href: `${base}${path(s.key, s.path)}` }));
  return (
    <div className="flex flex-col gap-4">
      {ctx.can('tenant.manage') && !state.setup_completed_at ? (
        <section className="card flex flex-wrap items-center justify-between gap-3" aria-labelledby="setup-title">
          <div>
            <h2 id="setup-title" className="font-bold text-on-surface">
              {t('welcome.banner.title')}
            </h2>
            <p className="text-sm">{t('welcome.banner.body')}</p>
          </div>
          <a className="btn btn-primary" href={`${base}/welcome`}>
            {t('welcome.banner.button')}
          </a>
        </section>
      ) : null}
      {welcome === 'demo' ? (
        <p role="status" className="card font-semibold text-on-surface">
          {t('welcome.demoReady')}
        </p>
      ) : null}
      {state.tours_seen.includes(tour) ? null : (
        <Tour
          title={t(`tour.${tour}.title` as MessageKey)}
          steps={steps}
          L={{ step: steps.map((_, i) => t('tour.stepOf', { n: i + 1, total: steps.length })), next: t('tour.next'), back: t('tour.back'), done: t('tour.done'), close: t('tour.close'), open: t('tour.open') }}
          onDone={tourSeenAction.bind(null, tenantKey, tour)}
        />
      )}
    </div>
  );
}
