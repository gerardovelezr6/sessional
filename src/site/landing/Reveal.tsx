'use client';
import gsap from 'gsap';
import { useEffect, useRef } from 'react';

// Content further down the page eases in as it is scrolled to: a short fade and a small rise, once.
// What is already on screen, and everything for people who ask for less motion, is left alone.
export function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    gsap.set(el, { opacity: 0, y: 16 });
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        gsap.to(el, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' });
        seen.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    seen.observe(el);
    // Someone tabbing into it shouldn't land on something invisible.
    const show = () => gsap.set(el, { opacity: 1, y: 0 });
    el.addEventListener('focusin', show);
    return () => {
      seen.disconnect();
      el.removeEventListener('focusin', show);
      gsap.killTweensOf(el);
      gsap.set(el, { clearProps: 'opacity,transform' });
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
