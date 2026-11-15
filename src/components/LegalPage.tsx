import Image from 'next/image';
import Link from 'next/link';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { LEGAL_UPDATED, legalDetails } from '@/platform/legal';
import { catalogs, translator, type MessageKey } from '@/messages';

// The privacy policy and the terms: numbered sections from the message catalogue, in English or
// Spanish (?lang=es). Lines starting with "• " are list items.
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
    <main lang={locale} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <Link href="/" className="self-start">
        <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-8 w-auto" />
      </Link>
      <div>
        <h1 className="page-title text-3xl">{t(`legal.${kind}.title` as MessageKey)}</h1>
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
      <p>{t(`legal.${kind}.intro` as MessageKey, vars)}</p>
      {sections.map((s, i) => (
        <section key={s} className="flex flex-col gap-2" aria-labelledby={`s${i}`}>
          <h2 id={`s${i}`} className="text-lg font-bold text-on-surface">
            {`${i + 1}. ${t(`${s}.title` as MessageKey)}`}
          </h2>
          {t(`${s}.body` as MessageKey, vars)
            .split('\n')
            .filter(Boolean)
            .map((line, j) => (line.startsWith('• ') ? <p key={j} className="ps-4 -indent-3">{line}</p> : <p key={j}>{line}</p>))}
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
