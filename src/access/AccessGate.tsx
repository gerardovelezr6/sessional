import { ActionForm } from '@/components/ActionForm';
import { BrandMark } from '@/components/BrandMark';
import { enterAccessCodeAction } from './actions';

// The page in front of everything when a school asks for a conference access code.
export function AccessGate({ tenantKey, name, logo, initials, hint, next, L }: { tenantKey: string; name: string; logo: string | null; initials: string | null; hint: string; next: string; L: { intro: string; code: string; enter: string; provided: string } }) {
  return (
    <main id="main" className="gate flex min-h-screen flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandMark logo={logo} initials={initials} size={56} />
          <h1 className="mt-2 text-xl font-bold text-on-surface">{name}</h1>
          <p className="text-sm">{L.intro}</p>
        </div>
        <ActionForm action={enterAccessCodeAction.bind(null, tenantKey)} submitLabel={L.enter}>
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="label" htmlFor="code">
              {L.code}
            </label>
            <input className="input" id="code" name="code" type="password" autoComplete="off" required autoFocus maxLength={200} />
          </div>
        </ActionForm>
        <p className="mt-4 text-center text-xs">{hint || L.provided}</p>
      </div>
    </main>
  );
}
