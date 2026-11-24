import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { FLAGS } from '@/platform/flags';
import { basePath } from '@/tenancy/context';
import { flagAction } from '../actions';

// Admin → Flags: each switch's default, the platform's value, and the schools with their own.
export default async function AdminFlags({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const base = await basePath();
  const data = await rpc<{ global: Record<string, { enabled: boolean; note: string }>; overrides: { key: string; enabled: boolean; tenant_id: string; slug: string }[] }>('platform_flags', {}, a);
  const { done } = await searchParams;
  return (
    <Shell title={t('platform.flags.title')} size="full">
      <div className="flex flex-col gap-4">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('platform.done.flag')}
          </p>
        ) : null}
        <p className="max-w-3xl text-sm">{t('platform.flags.help')}</p>
        {FLAGS.map((f) => {
          const g = data.global[f.key];
          const schools = data.overrides.filter((o) => o.key === f.key);
          return (
            <section key={f.key} className="card flex flex-col gap-2" aria-labelledby={`flag-${f.key}`}>
              <h2 id={`flag-${f.key}`} className="text-lg font-bold text-on-surface">
                {t(f.label)} <span className="font-mono text-xs font-normal">{f.key}</span>
              </h2>
              <p className="text-sm">{t(f.help)}</p>
              <p className="text-sm">{t(f.defaultOn ? 'platform.flags.defaultOn' : 'platform.flags.defaultOff')}</p>
              <ActionForm action={flagAction} submitLabel={t('platform.flags.save')} variant="secondary">
                <input type="hidden" name="key" value={f.key} />
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="label">{t('platform.flags.forAll', { flag: t(f.label) })}</span>
                    <select className="input w-auto" name="value" defaultValue={g === undefined ? 'default' : g.enabled ? 'on' : 'off'}>
                      <option value="default">{t('platform.flags.asDefault')}</option>
                      <option value="on">{t('settings.onOff.on')}</option>
                      <option value="off">{t('settings.onOff.off')}</option>
                    </select>
                  </label>
                  <label className="flex flex-1 flex-col gap-1">
                    <span className="label">{t('platform.flags.note')}</span>
                    <input className="input" name="note" defaultValue={g?.note ?? ''} maxLength={300} />
                  </label>
                </div>
              </ActionForm>
              {schools.length ? (
                <p className="text-sm">
                  {t('platform.flags.schools')}{' '}
                  {schools.map((o, i) => (
                    <span key={o.tenant_id}>
                      {i ? ', ' : ''}
                      <a className="underline underline-offset-2" href={`${base}/tenants/${o.tenant_id}`}>{`${o.slug} (${t(o.enabled ? 'settings.onOff.on' : 'settings.onOff.off')})`}</a>
                    </span>
                  ))}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}
