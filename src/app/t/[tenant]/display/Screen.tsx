'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';
import { fmt } from '@/i18n/fmt';
import type { ScreenView } from '@/live/screen';
import { useLive } from '@/live/useLive';
import { clock, remainingMs, type Timer } from '@/protocol/timer';

// A projection screen. Shows a code until a chair pairs it, then the committee: who has the floor
// and their time, the speakers list, caucuses and votes. It keeps the last good picture through a
// lost connection, marks it as reconnecting, and catches up by itself.

type Paired = Extract<ScreenView, { paired: true }>;
type L = Record<string, string>;

const name = (t: Record<string, string>, locale: string) => t[locale] ?? t[locale.split('-')[0]!] ?? t.en ?? Object.values(t)[0] ?? '';
// Retry delays after failures: quick at first, then every 30 seconds.
const BACKOFF = [2000, 4000, 8000, 15000, 30000];
const STALE_MS = 10_000;

// Short tones, made in the browser: no audio files to load.
function beep(ctx: AudioContext, times: number) {
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ctx.destination);
    const at = ctx.currentTime + i * 0.35;
    osc.start(at);
    osc.stop(at + 0.2);
  }
}

function useServerClock(serverNow: string) {
  const [offset, setOffset] = useState(() => Date.parse(serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(t);
  }, [offset]);
  return { now, learn: (iso: string, sentAt: number) => setOffset(Date.parse(iso) - (sentAt + Date.now()) / 2) };
}

function BigTimer({ timer, now, warnSeconds, label, size, sound, L }: { timer: Timer; now: number; warnSeconds: number; label: string; size: 'huge' | 'large'; sound: AudioContext | null; L: L }) {
  const left = remainingMs(timer, now);
  const over = left <= 0;
  const warn = !over && left <= warnSeconds * 1000;
  const running = !!timer.runningSince;
  // Sound once when the warning starts and once when time is up, only while running.
  const phase = !running ? 'idle' : over ? 'over' : warn ? 'warn' : 'ok';
  const last = useRef(phase);
  useEffect(() => {
    if (phase !== last.current && sound) {
      if (phase === 'warn') beep(sound, 1);
      if (phase === 'over') beep(sound, 3);
    }
    last.current = phase;
  }, [phase, sound]);
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="label-text">{label}</span>
      <span
        role="timer"
        aria-label={label}
        className={`screen-timer font-mono font-bold tabular-nums ${size === 'huge' ? 'text-[22vh] leading-none' : 'text-[12vh] leading-none'} ${over && running ? 'screen-alert' : warn ? 'screen-warn' : ''}`}
      >
        {clock(left)}
      </span>
      <span className="text-[2.5vh] font-semibold">{over ? L.timeUp : warn ? L.almost : running ? '' : L.paused}</span>
    </div>
  );
}

function Delegate({ d, size }: { d: Paired['delegates'][string] | undefined; size: 'big' | 'row' }) {
  if (!d) return null;
  return (
    <span className={`flex items-center gap-[1.5vh] ${size === 'big' ? 'text-[7vh] font-extrabold leading-tight' : 'text-[3vh] font-semibold'}`}>
      <Flag choice={d.flag} logoUrl={d.logoUrl} className={size === 'big' ? '!h-[6vh] !w-[9vh]' : '!h-[2.5vh] !w-[3.75vh]'} />
      {d.label}
    </span>
  );
}

function Projection({ v, now, sound, L }: { v: Paired; now: number; sound: AudioContext | null; L: L }) {
  const p = v.projection;
  const list = p.list;
  const current = list?.current ? v.delegates[list.current.delegate] : undefined;
  const layout = v.display.layout;
  const loc = v.locale;

  if (p.vote) {
    const t = p.vote.tally;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[4vh] text-center">
        <span className="label-text text-[2.5vh]">{L.voting}</span>
        <h2 className="text-[6vh] font-extrabold leading-tight">{p.vote.title}</h2>
        <p className="text-[2.5vh]">{fmt(L.voteFacts, loc, { majority: name(p.vote.majority, loc), eligible: p.vote.eligible })}</p>
        {t ? (
          <div className="grid grid-cols-3 gap-[4vw]">
            {(['yes', 'no', 'abstain'] as const).map((k) => (
              <div key={k} className="flex flex-col items-center">
                <span className="text-[14vh] font-extrabold tabular-nums leading-none">{t[k]}</span>
                <span className="label-text text-[2.5vh]">{L[k]}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[4vh] font-bold">{L.secret}</p>
        )}
        {p.vote.needed !== null ? <p className="text-[3vh]">{fmt(L.needed, loc, { needed: p.vote.needed })}</p> : null}
      </div>
    );
  }

  const caucus = p.caucus;
  const speakerBlock =
    list && (list.current || layout !== 'timer') ? (
      <div className="flex flex-col items-center gap-[3vh]">
        {list.current ? (
          <>
            <Delegate d={current} size="big" />
            <BigTimer timer={list.current.timer} now={now} warnSeconds={p.warnSeconds} label={L.timeLeft!} size={caucus ? 'large' : 'huge'} sound={sound} L={L} />
          </>
        ) : (
          <p className="text-[4vh] font-semibold">{L.nobody}</p>
        )}
      </div>
    ) : null;

  return (
    <div className={`grid flex-1 gap-[4vh] ${layout === 'standard' ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
      <div className="flex flex-col items-center justify-center gap-[4vh] text-center">
        {caucus ? (
          <div className="flex flex-col items-center gap-[2vh]">
            <span className="text-[4vh] font-extrabold">
              {name(caucus.name, loc)}
              {caucus.topic ? `: ${caucus.topic}` : ''}
            </span>
            <BigTimer timer={caucus.timer} now={now} warnSeconds={60} label={L.caucusLeft!} size={list ? 'large' : 'huge'} sound={sound} L={L} />
          </div>
        ) : p.session === null ? (
          <p className="text-[5vh] font-bold">{L.notInSession}</p>
        ) : null}
        {layout !== 'speakers' ? speakerBlock : null}
        {p.debateClosed && !caucus ? <p className="text-[3vh] font-semibold">{L.debateClosed}</p> : null}
      </div>
      {list && layout !== 'timer' ? (
        <div className="flex flex-col gap-[2vh]">
          {layout === 'speakers' ? speakerBlock : null}
          <h2 className="label-text text-[2.5vh]">{caucus ? L.caucusList : L.generalList}</h2>
          {list.next.length === 0 ? <p className="text-[3vh]">{L.listEmpty}</p> : null}
          <ol className="flex flex-col gap-[1.5vh]" aria-label={caucus ? L.caucusList : L.generalList}>
            {list.next.map((id, i) => (
              <li key={`${id}-${i}`} className="flex items-center gap-[2vh]">
                <span className="w-[4vh] text-[3vh] opacity-70">{i + 1}.</span>
                <Delegate d={v.delegates[id]} size="row" />
              </li>
            ))}
          </ol>
          {list.more ? <p className="text-[2.5vh] opacity-80">{fmt(L.more, loc, { count: list.more })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Screen({ initial, stateUrl, schoolName, logoUrl, L, Lpaired }: { initial: ScreenView | null; stateUrl: string; schoolName: string; logoUrl: string | null; L: L; Lpaired: L | null }) {
  const STATE_URL = stateUrl;
  const [view, setView] = useState<ScreenView | null>(initial);
  const [lastOk, setLastOk] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [audio, setAudio] = useState<AudioContext | null>(null);
  const [started, setStarted] = useState(false);
  const failures = useRef(0);
  const clockState = useServerClock(initial?.now ?? new Date().toISOString());
  const busy = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const again = useRef<() => void>(() => {});

  const fetchView = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const sentAt = Date.now();
    try {
      // Only signed-in pages are prefetched; this one asks the server every time.
      const res = await fetch(STATE_URL, { method: view ? 'GET' : 'POST', cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as ScreenView | { registered: false };
      if ('registered' in next) {
        // The device was forgotten (unpaired): ask for a new code.
        const again = await fetch(STATE_URL, { method: 'POST', cache: 'no-store' });
        if (!again.ok) throw new Error(String(again.status));
        setView((await again.json()) as ScreenView);
      } else {
        // Paired or unpaired since the page was made: the page's words change, so reload it.
        if (view && view.paired !== next.paired) window.location.reload();
        clockState.learn(next.now, sentAt);
        setView(next);
      }
      failures.current = 0;
      setLastOk(Date.now());
      setStale(false);
    } catch {
      failures.current++;
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => again.current(), BACKOFF[Math.min(failures.current - 1, BACKOFF.length - 1)]);
    } finally {
      busy.current = false;
    }
  }, [view, clockState, STATE_URL]);
  useEffect(() => {
    again.current = () => void fetchView();
  }, [fetchView]);

  // First visit: register to get a code.
  useEffect(() => {
    if (initial) return;
    const t = setTimeout(() => again.current(), 0);
    return () => clearTimeout(t);
  }, [initial]);

  const paired = view?.paired ? view : null;
  const mode = useLive(paired?.realtime ?? null, () => void fetchView(), { live: 30_000, degraded: paired ? 2000 : 3000 });

  // "Reconnecting" when nothing fresh for a while; a reload if the server keeps failing while the
  // network is up (for instance after an update), so a screen nobody touches heals itself.
  useEffect(() => {
    const t = setInterval(() => {
      const since = Date.now() - lastOk;
      setStale(since > STALE_MS);
      if (since > 10 * 60_000 && navigator.onLine) window.location.reload();
    }, 1000);
    return () => clearInterval(t);
  }, [lastOk]);
  useEffect(() => {
    const back = () => void fetchView();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [fetchView]);

  // Keep the screen awake while the page is shown.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
      } catch {
        // Not offered by this browser: nothing to do.
      }
    };
    void ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      document.removeEventListener('visibilitychange', ask);
      void lock?.release();
    };
  }, []);

  // One click or key turns on sound and full screen (browsers allow neither without one).
  const start = () => {
    setStarted(true);
    if (paired?.display.sound) {
      try {
        setAudio(new AudioContext());
      } catch {
        // No sound on this device; the colours still show the time.
      }
    }
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const status = stale ? L.reconnecting : mode === 'live' ? L.live : L.polling;
  const T = Lpaired ?? L;

  return (
    <div className="screen kiosk fixed inset-0 z-50 flex flex-col gap-[3vh] overflow-hidden p-[4vh]" onClick={started ? undefined : start} onKeyDown={started ? undefined : start} role="presentation">
      <header className="flex items-center gap-[2vh]">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-[5vh] w-auto" />
        ) : null}
        <div className="min-w-0 flex-1">
          {paired ? (
            <>
              <p className="truncate text-[3.5vh] font-extrabold leading-tight">
                {paired.committee.abbreviation ? `${paired.committee.abbreviation} · ` : ''}
                {paired.committee.name}
              </p>
              {paired.committee.topic ? <p className="truncate text-[2.2vh] opacity-85">{paired.committee.topic}</p> : null}
            </>
          ) : (
            <p className="text-[3vh] font-bold">{schoolName}</p>
          )}
        </div>
        {paired ? (
          <div className="flex flex-col items-end text-[2vh]">
            {paired.projection.session !== null ? <span className="font-semibold">{fmt(T.session, paired.locale, { number: paired.projection.session })}</span> : null}
            <span>{fmt(T.present, paired.locale, { present: paired.projection.present, members: paired.projection.members })}</span>
          </div>
        ) : null}
        <span role="status" className={`ms-[2vh] rounded-full px-[1.5vh] py-[0.5vh] text-[1.6vh] font-semibold ${stale ? 'screen-alert' : 'screen-chip'}`}>
          {status}
        </span>
      </header>

      {paired ? (
        <>
          <Projection v={paired} now={clockState.now} sound={audio} L={T} />
          {paired.projection.lastVote && !paired.projection.vote ? (
            <p className="screen-chip self-center rounded-full px-[3vh] py-[1vh] text-[2.6vh] font-semibold">
              {fmt(paired.projection.lastVote.vetoed ? T.resultVetoed : paired.projection.lastVote.passed ? T.resultPassed : T.resultFailed, paired.locale, {
                title: paired.projection.lastVote.title,
                yes: paired.projection.lastVote.tally.yes,
                no: paired.projection.lastVote.tally.no,
                abstain: paired.projection.lastVote.tally.abstain,
              })}
            </p>
          ) : null}
          {paired.projection.motions.length && !paired.projection.vote ? (
            <p className="text-center text-[2.2vh] opacity-85">
              {T.motions}: {paired.projection.motions.map((m) => name(m.name, paired.locale)).join(' · ')}
            </p>
          ) : null}
        </>
      ) : view && !view.paired ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[4vh] text-center">
          <p className="text-[3.5vh] font-semibold">{L.pairHelp}</p>
          <p className="font-mono text-[18vh] font-extrabold leading-none tracking-[0.2em]" aria-label={L.codeLabel}>
            {view.code}
          </p>
          <p className="max-w-[80vw] text-[2.5vh] opacity-85">{L.pairWhere}</p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[3vh]">{L.starting}</div>
      )}

      {paired && !started ? <p className="text-center text-[1.8vh] opacity-75">{paired.display.sound ? L.startSound : L.startFull}</p> : null}
    </div>
  );
}
