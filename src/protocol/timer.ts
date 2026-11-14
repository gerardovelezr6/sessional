// A countdown kept as times, not ticks: it is "running since" an instant plus the time already
// used. Any screen works out what is left from the shared clock, so a timer keeps going through a
// lost connection and every screen shows the same number.

export interface Timer {
  seconds: number;
  runningSince: string | null;
  usedMs: number;
}

export const newTimer = (seconds: number): Timer => ({ seconds, runningSince: null, usedMs: 0 });

export function usedMs(t: Timer, nowMs: number): number {
  return t.usedMs + (t.runningSince ? Math.max(0, nowMs - Date.parse(t.runningSince)) : 0);
}

// Negative when the time is over.
export const remainingMs = (t: Timer, nowMs: number) => t.seconds * 1000 - usedMs(t, nowMs);

export const startTimer = (t: Timer, now: string): Timer => (t.runningSince ? t : { ...t, runningSince: now });
export const pauseTimer = (t: Timer, now: string): Timer => (t.runningSince ? { ...t, runningSince: null, usedMs: usedMs(t, Date.parse(now)) } : t);
export const resetTimer = (t: Timer): Timer => newTimer(t.seconds);

// "1:05", "0:09"; past zero: "-0:03".
export function clock(ms: number): string {
  const s = ms > 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
  const sign = ms <= 0 && s > 0 ? '-' : '';
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
