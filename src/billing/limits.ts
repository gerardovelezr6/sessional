import { RpcError } from '@/data/rpc';
import type { MessageKey, Translate } from '@/messages';

// A refused insert because of the school's plan, in the reader's words (or null for other errors).
const WHAT: Record<string, MessageKey> = {
  committees: 'billing.limit.committees',
  delegates: 'billing.limit.delegates',
  staff: 'billing.limit.staff',
  active_conferences: 'billing.limit.active_conferences',
};

export function limitError(e: unknown, t: Translate): string | null {
  const l = e instanceof RpcError ? e.limit : null;
  if (!l) return null;
  return t(WHAT[l.what] ?? 'billing.limit.other', { max: l.max });
}
