import { DEFAULT_LOCALE, translator, type Locale } from '@/messages';
import { PoweredBy } from './PoweredBy';

// Centred single-column page used by the sign-in and account pages.
const WIDTH = { narrow: 'max-w-md', wide: 'max-w-3xl', full: 'max-w-7xl' } as const;

// `centered` is for short pages that stand alone (sign-in, invitations); others start at the top.
// `quietTitle`: the page shows its own heading, so the title is kept for screen readers only.
// `crumbs`: where this page sits, from the home page down; the last one is this page.
export function Shell({ title, subtitle, children, wide = false, size, centered = false, locale, quietTitle = false, crumbs }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean; size?: keyof typeof WIDTH; centered?: boolean; locale?: Locale; quietTitle?: boolean; crumbs?: { href?: string; label: string }[] }) {
  return (
    <main className={`flex flex-1 flex-col items-center p-6 ${centered ? 'justify-center' : 'pt-8'}`}>
      <div className={`w-full ${WIDTH[size ?? (wide ? 'wide' : 'narrow')]}`}>
        {crumbs?.length ? (
          <nav aria-label={translator(locale ?? DEFAULT_LOCALE)('nav.breadcrumb')} className="mb-3 text-sm">
            <ol className="flex flex-wrap items-center gap-1">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <span aria-hidden="true" className="text-on-surface-muted">›</span> : null}
                  {c.href ? (
                    <a href={c.href} className="font-semibold underline-offset-2 hover:underline">
                      {c.label}
                    </a>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className={quietTitle ? 'sr-only' : 'page-title text-2xl'}>{title}</h1>
        {subtitle ? <p className="mt-1 text-on-surface-muted">{subtitle}</p> : null}
        {quietTitle ? null : <div className="mb-6" />}
        {children}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
