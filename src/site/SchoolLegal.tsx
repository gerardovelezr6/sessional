import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { requireTenant } from '@/tenancy/context';
import { schoolBranding } from './whiteLabel';

// A school's own privacy policy or terms (plans with legal pages). Lines starting with "# " are
// headings, blank lines separate paragraphs. Without its own text, Sessional's pages apply.
export async function SchoolLegal({ tenantKey, kind }: { tenantKey: string; kind: 'privacy' | 'terms' }) {
  const tenant = await requireTenant(tenantKey);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const root = `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;
  const school = await schoolBranding();
  const text = localize(config.legal[kind], locale).trim();
  if (!school?.ownLegal || !text) redirect(`${root}/${kind}${locale === 'es' ? '?lang=es' : ''}`);
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <Shell title={t(kind === 'privacy' ? 'legal.privacy.title' : 'legal.terms.title')} subtitle={tenant.name} wide locale={locale}>
      <article className="card flex flex-col gap-3">
        {blocks.map((b, i) =>
          b.startsWith('# ') ? (
            <h2 key={i} className="mt-2 text-lg font-bold text-on-surface">
              {b.slice(2)}
            </h2>
          ) : (
            <p key={i} className="whitespace-pre-line text-sm">
              {b}
            </p>
          ),
        )}
        <p className="mt-4 border-t border-border pt-3 text-xs">
          {t('legal.school.processor')}{' '}
          <a className="underline underline-offset-2" href={`${root}/privacy${locale === 'es' ? '?lang=es' : ''}`}>
            {t('legal.school.ours')}
          </a>
        </p>
      </article>
    </Shell>
  );
}
