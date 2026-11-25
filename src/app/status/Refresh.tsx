'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Checks again every minute while the page is open (the server keeps results 30 seconds).
export function Refresh() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
