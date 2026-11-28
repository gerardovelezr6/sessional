'use client';
import Link from 'next/link';

// The header's logo on the home page. Already home, it takes the visitor back to the first screen,
// playing the opening's reverses on the way (see Opening); a plain link elsewhere or with a
// modifier key (new tab, new window).
export function HomeLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || window.location.pathname !== '/') return;
        e.preventDefault();
        window.dispatchEvent(new Event('sessional:home'));
      }}
    >
      {children}
    </Link>
  );
}
