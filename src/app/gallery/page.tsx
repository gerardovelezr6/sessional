import type { Metadata } from 'next';
import { SECTION_LABELS } from '@/config/registry';
import type { SectionName } from '@/config/schema';
import { rpc } from '@/data/rpc';
import { SHAREABLE } from '@/gallery/sections';
import { localize, translator } from '@/messages';
import { SitePage } from '@/site/SitePage';

export const metadata: Metadata = { title: 'Community gallery · Sessional' };
export const dynamic = 'force-dynamic';

interface Card {
  id: string;
  section: SectionName;
  author: string;
  name: Record<string, string>;
  description: Record<string, string>;
  installs: number;
  version: number;
}

// The community gallery on the main website: what schools shared and Sessional reviewed, grouped
// by kind. Installing happens from a school's own settings.
export default async function PublicGallery({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const cards = await rpc<Card[]>('gallery_public', {}, 'service').catch(() => [] as Card[]);
  const groups = SHAREABLE.map((s) => ({ section: s, cards: cards.filter((c) => c.section === s) })).filter((g) => g.cards.length);
  return (
    <SitePage t={t} locale={locale} title={t('gallery.public.title')} intro={t('gallery.public.intro')} path="/gallery">
      {groups.length ? (
        groups.map((g) => (
          <section key={g.section} className="flex flex-col gap-3 border-t border-border py-6" aria-labelledby={`g-${g.section}`}>
            <h2 id={`g-${g.section}`} className="text-xl font-semibold text-on-surface">
              {t(SECTION_LABELS[g.section])}
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {g.cards.map((c) => (
                <li key={c.id} className="card flex flex-col gap-1">
                  <h3 className="font-semibold text-on-surface">{localize(c.name, locale, t('gallery.untitled'))}</h3>
                  <p className="text-xs">{t('gallery.public.meta', { school: c.author, version: c.version, installs: c.installs })}</p>
                  {localize(c.description, locale, '') ? <p className="text-sm">{localize(c.description, locale, '')}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p>{t('gallery.public.empty')}</p>
      )}
      <p className="mt-6 text-sm">{t('gallery.public.how')}</p>
    </SitePage>
  );
}
