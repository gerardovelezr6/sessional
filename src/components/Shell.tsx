import type { Locale } from '@/messages';
import { PoweredBy } from './PoweredBy';

// Centred single-column page used by the sign-in and account pages.
const WIDTH = { narrow: 'max-w-md', wide: 'max-w-3xl', full: 'max-w-6xl' } as const;

// `centered` is for short pages that stand alone (sign-in, invitations); others start at the top.
export function Shell({ title, subtitle, children, wide = false, size, centered = false, locale }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean; size?: keyof typeof WIDTH; centered?: boolean; locale?: Locale }) {
  return (
    <main className={`flex flex-1 flex-col items-center p-6 ${centered ? 'justify-center' : 'pt-8'}`}>
      <div className={`w-full ${WIDTH[size ?? (wide ? 'wide' : 'narrow')]}`}>
        <h1 className="page-title text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-on-surface-muted">{subtitle}</p> : null}
        <div className="mb-6" />
        {children}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
