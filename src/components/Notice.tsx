import type { Locale } from '@/messages';
import { PoweredBy } from './PoweredBy';

// A full-page message: not found, unavailable, not configured.
export function Notice({ title, body, locale }: { title: string; body: string; locale?: Locale }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-12 text-center">
      <h1 className="text-2xl font-bold text-on-surface">{title}</h1>
      <p className="max-w-md text-on-surface-muted">{body}</p>
      <PoweredBy locale={locale} />
    </main>
  );
}
