import type { Locale } from '@/messages';
import { PoweredBy } from './PoweredBy';

// Centred single-column page used by the sign-in and account pages.
export function Shell({ title, subtitle, children, wide = false, locale }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean; locale?: Locale }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <h1 className="text-2xl font-bold text-on-surface">{title}</h1>
        {subtitle ? <p className="mt-1 text-on-surface-muted">{subtitle}</p> : null}
        <div className="mb-6" />
        {children}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
