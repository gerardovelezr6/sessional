'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The main links in the page header. The page being shown is marked for everyone, including
// screen readers (aria-current).
export function NavLinks({ label, links }: { label: string; links: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  const current = (href: string, exact?: boolean) => (exact ? path === href || path === `${href}/` || (href.endsWith('/') && path === href.slice(0, -1)) : path.startsWith(href));
  return (
    <nav aria-label={label} className="app-nav flex flex-wrap items-center gap-1">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l.href, l.exact) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
