import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { translator } from '@/messages';

export const metadata: Metadata = { title: translator('en')('legal.privacy.title') };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return <LegalPage kind="privacy" lang={(await searchParams).lang ?? 'en'} />;
}
