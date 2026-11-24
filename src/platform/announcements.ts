import 'server-only';
import { rpc } from '@/data/rpc';

// Platform announcements (Admin → Announcements): shown at the top of every school's pages, or
// only to the people who manage a school. Read with the server role, kept 30 seconds.

export interface PlatformAnnouncement {
  id: string;
  message: Record<string, string>;
  tone: 'info' | 'warning';
  audience: 'all' | 'managers';
}

const TTL_MS = 30_000;
let cached: { at: number; list: PlatformAnnouncement[] } | null = null;

export async function liveAnnouncements(): Promise<PlatformAnnouncement[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.list;
  const list = await rpc<PlatformAnnouncement[]>('platform_announcements_live', {}, 'service').catch(() => cached?.list ?? []);
  cached = { at: Date.now(), list };
  return list;
}
