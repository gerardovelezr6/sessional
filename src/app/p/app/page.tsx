import { redirect } from 'next/navigation';
import { accessToken } from '@/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { rpc, RpcError } from '@/data/rpc';
import { DEFAULT_LOCALE, localize, translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { basePath } from '@/tenancy/context';
import { appSignOutAction } from './actions';

interface Conference {
  slug: string;
  name: string;
  role_key: string;
  role_name: Record<string, string>;
}

// Every school the signed-in person belongs to, with a link to each school's own address.
export default async function YourConferences() {
  const t = translator(DEFAULT_LOCALE);
  const base = await basePath();
  const token = await accessToken();
  if (!token) redirect(`${base}/login`);

  let list: Conference[];
  try {
    list = await rpc<Conference[]>('my_conferences', {}, { token });
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) redirect(`${base}/login`);
    throw e;
  }
  const scheme = isSecureOrigin() ? 'https' : 'http';

  return (
    <Shell title={t('app.title')} wide>
      <div className="flex flex-col gap-4">
        {list.length === 0 ? (
          <p className="card">{t('app.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((c) => (
              <li key={c.slug} className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-on-surface">{c.name}</p>
                  <p className="text-sm">{t('home.role', { role: localize(c.role_name, DEFAULT_LOCALE, c.role_key) })}</p>
                </div>
                <a className="btn btn-primary" href={`${scheme}://${c.slug}.${rootDomain()}/`}>
                  {t('app.open')}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">{t('app.signInEach')}</p>
        <ActionForm action={appSignOutAction} submitLabel={t('auth.signOut')} variant="secondary" />
      </div>
    </Shell>
  );
}
