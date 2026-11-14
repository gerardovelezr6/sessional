import type { Locale } from '@/messages';
import { PoweredBy } from './PoweredBy';

// Centred single-column page used by the sign-in and account pages.
const WIDTH = { narrow: 'max-w-md', wide: 'max-w-3xl', full: 'max-w-7xl' } as const;

// `centered` is for short pages that stand alone (sign-in, invitations); others start at the top.
// `quietTitle`: the page shows its own heading, so the title is kept for screen readers only.
export function Shell({ title, subtitle, children, wide = false, size, centered = false, locale, quietTitle = false }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean; size?: keyof typeof WIDTH; centered?: boolean; locale?: Locale; quietTitle?: boolean }) {
  return (
    <main className={`flex flex-1 flex-col items-center p-6 ${centered ? 'justify-center' : 'pt-8'}`}>
      <div className={`w-full ${WIDTH[size ?? (wide ? 'wide' : 'narrow')]}`}>
        <h1 className={quietTitle ? 'sr-only' : 'page-title text-2xl'}>{title}</h1>
        {subtitle ? <p className="mt-1 text-on-surface-muted">{subtitle}</p> : null}
        {quietTitle ? null : <div className="mb-6" />}
        {children}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
