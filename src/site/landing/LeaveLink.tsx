'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// The opening's buttons. Pressed, the logo's square grows to cover the screen (as the opening
// does, sine in-out), then: for a place on this page, the page is there under it and the magenta
// fades away; for another page, that page opens (fetched ahead, so it's ready) and the magenta
// fades away over it. A plain link for less motion, with a modifier key, or before the opening is
// at rest.
const EASE = 'cubic-bezier(0.37, 0, 0.63, 1)';

export function LeaveLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!href.startsWith('#')) router.prefetch(href);
  }, [href, router]);
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const square = document.querySelector<SVGRectElement>('.opening-stage svg rect');
        if (!square || square.getAttribute('visibility') === 'hidden' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          if (href.startsWith('#')) return;
          e.preventDefault();
          router.push(href);
          return;
        }
        e.preventDefault();
        const r = square.getBoundingClientRect();
        const cover = document.createElement('div');
        cover.setAttribute('aria-hidden', 'true');
        Object.assign(cover.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, background: getComputedStyle(square).fill, zIndex: '60', pointerEvents: 'none' });
        document.body.appendChild(cover);
        square.style.visibility = 'hidden';
        const side = Math.hypot(window.innerWidth, window.innerHeight);
        const grow = cover.animate(
          [
            { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` },
            { left: `${(window.innerWidth - side) / 2}px`, top: `${(window.innerHeight - side) / 2}px`, width: `${side}px`, height: `${side}px` },
          ],
          { duration: 750, easing: EASE, fill: 'forwards' },
        );
        const clear = () => {
          square.style.visibility = '';
          cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: EASE, fill: 'forwards' }).onfinish = () => cover.remove();
        };
        grow.onfinish = () => {
          if (href.startsWith('#')) {
            document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'instant', block: 'start' });
            window.history.pushState(null, '', href);
            requestAnimationFrame(clear);
            return;
          }
          const path = new URL(href, window.location.href).pathname;
          router.push(href);
          // The magenta stays until the next page is there, then fades away over it.
          const started = performance.now();
          const wait = () => (window.location.pathname === path || performance.now() - started > 5000 ? requestAnimationFrame(() => requestAnimationFrame(clear)) : requestAnimationFrame(wait));
          wait();
        };
      }}
    >
      {children}
    </a>
  );
}
