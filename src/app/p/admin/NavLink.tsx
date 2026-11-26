'use client';
import { usePathname } from 'next/navigation';

// A link in the console's menu, marked when it is the page being shown.
export function NavLink({ href, path, children }: { href: string; path: string; children: React.ReactNode }) {
  const here = usePathname() ?? '/';
  const current = path === '/' ? here === '/' || here === '' : here === path || here.startsWith(`${path}/`);
  return (
    <a href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </a>
  );
}
