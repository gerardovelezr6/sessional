import Image from 'next/image';
import Link from 'next/link';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { LEGAL_UPDATED, legalDetails } from '@/platform/legal';
import { catalogs, translator, type MessageKey } from '@/messages';

// The privacy policy and the terms: numbered sections from the message catalogue, in English or
// Spanish (?lang=es). Lines starting with "• " become a real list (consecutive ones, one list).
export function LegalPage({ kind, lang }: { kind: 'privacy' | 'terms'; lang: string }) {
  const locale = lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const d = legalDetails();
  const vars = { operator: d.operator, email: d.email, country: d.country, updated: LEGAL_UPDATED };
  const sections = Object.keys(catalogs.en)
    .filter((k) => k.startsWith(`legal.${kind}.s`) && k.endsWith('.title'))
    .sort((a, b) => Number(a.split('.')[2]!.slice(1)) - Number(b.split('.')[2]!.slice(1)))
    .map((k) => k.slice(0, -'.title'.length));
  const other = kind === 'privacy' ? 'terms' : 'privacy';
  return (
    <main id="main" lang={locale} className="site-type mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <Link href="/" className="self-start">
        <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-8 w-auto" />
      </Link>
      <div>
        <h1 className="site-display text-4xl text-on-surface">{t(`legal.${kind}.title` as MessageKey)}</h1>
        <p className="mt-3 text-sm">{t('legal.updated', vars)}</p>
        <p className="mt-1 text-sm">
          <a className="underline" href={`?lang=${locale === 'en' ? 'es' : 'en'}`}>
            {t('legal.otherLanguage')}
          </a>
        </p>
      </div>
      {!d.complete ? (
        <p role="note" className="announcement">
          {t('legal.incomplete')}
        </p>
      ) : null}
      <p className="max-w-[60ch]">{t(`legal.${kind}.intro` as MessageKey, vars)}</p>
      {sections.map((s, i) => (
        <section key={s} className="flex flex-col gap-2" aria-labelledby={`s${i}`}>
          <h2 id={`s${i}`} className="text-lg font-bold text-on-surface">
            {`${i + 1}. ${t(`${s}.title` as MessageKey)}`}
          </h2>
          <LegalBody text={t(`${s}.body` as MessageKey, vars)} />
        </section>
      ))}
      <p className="border-t border-border pt-4 text-sm">
        <Link className="underline" href={`/${other}${locale === 'es' ? '?lang=es' : ''}`}>
          {t(`legal.${other}.title` as MessageKey)}
        </Link>
      </p>
    </main>
  );
}

// A section's text: paragraphs, and runs of "• " lines as one bulleted list.
function LegalBody({ text }: { text: string }) {
  const blocks: ({ kind: 'p'; text: string } | { kind: 'ul'; items: string[] })[] = [];
  for (const line of text.split('\n').filter(Boolean)) {
    const last = blocks.at(-1);
    if (line.startsWith('• ')) {
      if (last?.kind === 'ul') last.items.push(line.slice(2));
      else blocks.push({ kind: 'ul', items: [line.slice(2)] });
    } else blocks.push({ kind: 'p', text: line });
  }
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i} className="flex max-w-[60ch] list-disc flex-col gap-1.5 ps-5 marker:text-on-surface-muted">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="max-w-[60ch]">
            {b.text}
          </p>
        ),
      )}
    </>
  );
}
