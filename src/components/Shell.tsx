import { PoweredBy } from './PoweredBy';

// Centred single-column page used by the sign-in and account pages.
export function Shell({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <h1 className="mb-6 text-2xl font-bold text-on-surface">{title}</h1>
        {children}
      </div>
      <PoweredBy />
    </main>
  );
}
