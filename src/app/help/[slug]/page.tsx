import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readArticle } from '@/help/center';
import { Markdown } from '@/help/Markdown';
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
  return (
    <SitePage t={t} locale={locale} title={a.title} intro={a.summary} path={`/help/${slug}`}>
      <p className="-mt-2 mb-4 text-sm">
        <a className="font-semibold underline underline-offset-2" href={`/help${locale === 'es' ? '?lang=es' : ''}`}>
          {t('helpCenter.back')}
        </a>
      </p>
      <article className="flex max-w-2xl flex-col gap-3 text-base leading-relaxed">
        <Markdown source={a.body} />
      </article>
    </SitePage>
  );
}
