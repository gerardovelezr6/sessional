'use client';
import { useEffect, useState } from 'react';

// The page's sections, with the one being read marked for sighted and screen-reader users alike.
export function SectionNav({ label, links }: { label: string; links: { id: string; text: string }[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const sections = links.map((l) => document.getElementById(l.id)).filter((s): s is HTMLElement => !!s);
    const seen = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    sections.forEach((s) => seen.observe(s));
    // Above the first section (the opening of the page), no section is current.
    const top = () => {
      if (sections[0] && sections[0].getBoundingClientRect().top > window.innerHeight * 0.2) setCurrent(null);
    };
    window.addEventListener('scroll', top, { passive: true });
    return () => {
      seen.disconnect();
      window.removeEventListener('scroll', top);
    };
  }, [links]);
  return (
    <nav aria-label={label} className="-mx-1 flex gap-x-5 overflow-x-auto whitespace-nowrap px-1 text-sm">
      {links.map((l) => (
        <a
          key={l.id}
          href={`#${l.id}`}
          aria-current={current === l.id ? 'location' : undefined}
          className="py-1 underline-offset-4 hover:text-on-surface hover:underline aria-[current=location]:font-semibold aria-[current=location]:text-on-surface aria-[current=location]:underline"
        >
          {l.text}
        </a>
      ))}
    </nav>
  );
}
