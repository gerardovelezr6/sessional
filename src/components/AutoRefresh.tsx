'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Reloads the page's data every few seconds, while the tab is visible.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
