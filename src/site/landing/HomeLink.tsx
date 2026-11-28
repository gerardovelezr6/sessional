'use client';
import Link from 'next/link';

// The header's logo on the home page. From wherever the visitor is, magenta fades in over the
// screen, the page goes back to the first screen under it (nothing scrolls in sight, the opening
// is put at rest), and the magenta shrinks into the logo's square (sine in-out). With less motion
// it simply goes to the top; elsewhere, or with a modifier key, it is a plain link home.
const EASE = 'cubic-bezier(0.37, 0, 0.63, 1)';

export function HomeLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || window.location.pathname !== '/') return;
        e.preventDefault();
        const home = () => window.dispatchEvent(new Event('sessional:home'));
        const square = document.querySelector<SVGRectElement>('.opening-stage svg rect');
        if (!square || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.querySelector('[data-home-cover]')) {
          home();
          return;
        }
        const W = window.innerWidth;
        const H = window.innerHeight;
        const cover = document.createElement('div');
        cover.dataset.homeCover = '1';
        cover.setAttribute('aria-hidden', 'true');
        Object.assign(cover.style, { position: 'fixed', left: '0px', top: '0px', width: `${W}px`, height: `${H}px`, background: getComputedStyle(square).fill, zIndex: '60', pointerEvents: 'none', opacity: '0' });
        document.body.appendChild(cover);
        cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: EASE, fill: 'forwards' }).onfinish = () => {
          home();
          // Two frames for the first screen to be laid out, then the magenta goes into the square.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const r = square.getBoundingClientRect();
              const side = Math.hypot(W, H);
              square.style.visibility = 'hidden';
              const shrink = cover.animate(
                [
                  { left: `${(W - side) / 2}px`, top: `${(H - side) / 2}px`, width: `${side}px`, height: `${side}px` },
                  { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` },
                ],
                { duration: 950, easing: EASE, fill: 'forwards' },
              );
              shrink.onfinish = () => {
                square.style.visibility = '';
                cover.remove();
              };
            }),
          );
        };
      }}
    >
      {children}
    </Link>
  );
}
