import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readArticle } from '@/help/center';
import { Markdown, parseMarkdown, slugOf } from '@/help/Markdown';
import { translator } from '@/messages';
import { SitePage } from '@/site/SitePage';

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const a = await readArticle((await params).slug, (await searchParams).lang === 'es' ? 'es' : 'en');
  return { title: a ? `${a.title} · Sessional` : 'Sessional', description: a?.summary };
}

// One help article.
export default async function HelpArticle({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params;
  const locale = (await searchParams).lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const a = await readArticle(slug, locale);
  if (!a) notFound();
  const sections = parseMarkdown(a.body).flatMap((b) => (b.kind === 'h2' ? [b.text] : []));
  return (
    <SitePage t={t} locale={locale} title={a.title} intro={a.summary} path={`/help/${slug}`}>
      <p className="-mt-2 mb-4 text-sm">
        <a className="font-semibold underline underline-offset-2" href={`/help${locale === 'es' ? '?lang=es' : ''}`}>
          {t('helpCenter.back')}
        </a>
      </p>
      {sections.length > 2 ? (
        <nav aria-label={t('helpCenter.onThisPage')} className="border-s-2 border-border ps-4 text-sm">
          <p className="label-text mb-1">{t('helpCenter.onThisPage')}</p>
          <ul className="flex flex-col gap-1">
            {sections.map((h) => (
              <li key={h}>
                <a className="underline-offset-2 hover:underline" href={`#${slugOf(h)}`}>
                  {h}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <article className="flex max-w-[68ch] flex-col gap-4 text-base leading-relaxed">
        <Markdown source={a.body} />
      </article>
      <p className="mt-4 border-t border-border pt-4 text-sm">
        {t('helpCenter.more')}{' '}
        <a className="font-semibold underline underline-offset-2" href={`/support${locale === 'es' ? '?lang=es' : ''}`}>
          {t('helpCenter.write')}
        </a>
      </p>
    </SitePage>
  );
}
