import 'server-only';
import { databaseEnv } from '@/platform/env';

// Announces that a committee changed: "revision N", nothing else, on the committee's channel.
// Consoles and screens that hear it fetch what they may see from the server. A failed announcement
// only slows them down to their regular polling, so it is never an error for the chair.

const TIMEOUT_MS = 1500;

export async function announce(channel: string | null | undefined, revision: number): Promise<boolean> {
  const env = databaseEnv();
  if (!env || !channel) return false;
  try {
    const res = await fetch(`${env.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` },
      body: JSON.stringify({ messages: [{ topic: channel, event: 'revision', payload: { revision }, private: false }] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// What a browser needs to listen: the public project address and key, and the channel.
export function realtimeConfig(channel: string | null | undefined): { url: string; key: string; channel: string } | null {
  const env = databaseEnv();
  if (!env || !channel || !env.anonKey) return null;
  return { url: env.url, key: env.anonKey, channel };
}
