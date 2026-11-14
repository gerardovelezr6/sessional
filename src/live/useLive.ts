'use client';
import { RealtimeClient } from '@supabase/realtime-js';
import { useEffect, useRef, useState } from 'react';

// Keeps a screen or console up to date. When realtime works, it listens for "revision N" on the
// committee's channel and fetches at once, with a slow poll as a safety net. When realtime is
// unavailable (blocked network, outage, tests), it polls more often: the degraded mode.

export interface RealtimeConfig {
  url: string;
  key: string;
  channel: string;
}

export type LiveMode = 'connecting' | 'live' | 'polling';

const CONNECT_TIMEOUT_MS = 5000;

export function useLive(config: RealtimeConfig | null, onSignal: (revision: number | null) => void, poll: { live: number; degraded: number }): LiveMode {
  const [mode, setMode] = useState<LiveMode>(config ? 'connecting' : 'polling');
  const signal = useRef(onSignal);
  useEffect(() => {
    signal.current = onSignal;
  }, [onSignal]);

  // Realtime, when configured.
  useEffect(() => {
    if (!config) return;
    let client: RealtimeClient | null = null;
    let stopped = false;
    const fallback = setTimeout(() => !stopped && setMode((m) => (m === 'live' ? m : 'polling')), CONNECT_TIMEOUT_MS);
    try {
      client = new RealtimeClient(`${config.url.replace(/^http/, 'ws')}/realtime/v1`, { params: { apikey: config.key }, heartbeatIntervalMs: 15000 });
      const channel = client.channel(config.channel, { config: { broadcast: { self: false } } });
      channel.on('broadcast', { event: 'revision' }, (msg) => {
        const r = Number((msg.payload as { revision?: unknown } | undefined)?.revision);
        signal.current(Number.isFinite(r) ? r : null);
      });
      channel.subscribe((status) => {
        if (stopped) return;
        if (status === 'SUBSCRIBED') {
          setMode('live');
          // Catch up on anything missed while connecting.
          signal.current(null);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setMode('polling');
      });
    } catch {
      // Realtime could not start here: polling takes over when the fallback timer fires.
    }
    return () => {
      stopped = true;
      clearTimeout(fallback);
      void client?.removeAllChannels();
      client?.disconnect();
    };
  }, [config]);

  // Polling: slow while realtime works, quicker while it does not.
  const every = mode === 'live' ? poll.live : poll.degraded;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') signal.current(null);
    }, every);
    return () => clearInterval(t);
  }, [every]);

  return mode;
}
