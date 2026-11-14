'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';
import { fmt } from '@/i18n/fmt';
import { apply, type Command, type LiveState } from '@/protocol/engine';
import type { RunResult } from '@/protocol/run';
import { countsOf, quorumOf } from '@/protocol/rules';
import type { Pack } from '@/protocol/schema';
import type { FlagChoice } from '@/structure/flags';
import { drop, keep, loadOutbox } from './outbox';
import type { ConsoleTab } from './tabs';
import { Floor, PhoneBar, Shortcuts, useServerNow, useShortcuts } from './floor';
import { DisciplinePanel, MotionsPanel, PointsPanel, VotePanel, type VotableDocument } from './procedure';

export interface ConsoleDelegate {
  id: string;
  label: string;
  flag: FlagChoice;
  logoUrl: string | null;
}

interface Pending {
  id: string;
  command: Command;
}

interface Props {
  initial: { revision: number; state: LiveState };
  protocol: Pack;
  // The rules the next session would open with (the school's current choice).
  nextProtocol: Pack;
  sessionsHeld: number;
  delegates: ConsoleDelegate[];
  locale: string;
  timeZone: string;
  run: (envelope: { id: string; base: number; command: Command }) => Promise<RunResult & { now: string }>;
  poll: () => Promise<{
    revision: number;
    state: LiveState;
    now: string;
  } | null>;
  // The server's time when the page was made.
  serverNow: string;
  // Delegates who may veto substantive votes here.
  vetoHolders: string[];
  // Documents on the floor that can be put to a vote.
  documents: VotableDocument[];
  // Whose unsent changes on this device belong to this console: person and committee.
  outboxKey: string;
  // One tab per part, or everything on one page (the school's choice).
  layout: 'tabs' | 'single';
  committee: { name: string; abbreviation: string; topic: string };
  initialTab: ConsoleTab;
  L: Record<string, string>;
}


const POLL_MS = 5000;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

const nameOf = (name: Record<string, string>, locale: string) => name[locale] ?? name[locale.split('-')[0]!] ?? name.en ?? Object.values(name)[0] ?? '';

export function Console(p: Props) {
  const { L, locale } = p;
  const [confirmed, setConfirmed] = useState(p.initial);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // The open tab is in the address (?tab=), so a reload or a shared link opens the same one.
  const [tab, setTab] = useState<ConsoleTab>(p.initialTab);
  const chooseTab = (t: ConsoleTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(window.history.state, '', url);
  };
  const retries = useRef(0);
  // How far the server's clock is from this device's: timers count on the server's clock.
  const [offset, setOffset] = useState(() => Date.parse(p.serverNow) - Date.now());
  const learnClock = useCallback((serverIso: string, sentAt: number) => {
    const receivedAt = Date.now();
    setOffset(Date.parse(serverIso) - (sentAt + receivedAt) / 2);
  }, []);
  const now = useServerNow(offset);
  const ids = useMemo(() => p.delegates.map((d) => d.id), [p.delegates]);

  // The rules in force: the open session's, else what a new session would use.
  const pack = confirmed.state.session ? p.protocol : p.nextProtocol;
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeStyle: 'short',
        timeZone: p.timeZone,
      }),
    [locale, p.timeZone],
  );

  // What the screen shows: the confirmed state with the changes still on their way applied on top.
  const sessionsHeld = Math.max(p.sessionsHeld, confirmed.state.held);
  const shown = useMemo(() => {
    let s = confirmed.state;
    for (const q of queue) {
      const r = apply(s, q.command, {
        protocol: pack,
        delegates: ids,
        sessionsHeld,
        now: new Date(now).toISOString(),
      });
      if (r.ok) s = r.state;
    }
    return s;
  }, [confirmed, queue, pack, ids, sessionsHeld, now]);
  const pendingFor = useMemo(() => new Set(queue.flatMap((q) => (q.command.type === 'attendance.set' ? [q.command.delegate] : []))), [queue]);

  const errorText = useCallback((code: string) => L[`error_${code}`] ?? L.error_failed ?? '', [L]);

  // The queue lives in refs too, so a send in flight always sees the latest state.
  const queueRef = useRef<Pending[]>([]);
  const revision = useRef(p.initial.revision);
  const busy = useRef(false);
  const again = useRef<() => void>(() => {});
  const accept = useCallback((view: { revision: number; state: LiveState }) => {
    revision.current = view.revision;
    setConfirmed(view);
  }, []);
  const setQ = (q: Pending[]) => {
    queueRef.current = q;
    setQueue(q);
  };

  // Sends queued commands one at a time; each waits for the server's answer before the next.
  const pump = useCallback(async () => {
    if (busy.current) return;
    const head = queueRef.current[0];
    if (!head) return;
    busy.current = true;
    let result: RunResult & { now: string };
    const sentAt = Date.now();
    try {
      result = await p.run({
        id: head.id,
        base: revision.current,
        command: head.command,
      });
      learnClock(result.now, sentAt);
    } catch {
      // No answer: keep the command and send it again with the same id, so it is applied once.
      busy.current = false;
      setOffline(true);
      const wait = RETRY_MS[Math.min(retries.current++, RETRY_MS.length - 1)]!;
      setTimeout(() => again.current(), wait);
      return;
    }
    busy.current = false;
    retries.current = 0;
    setOffline(false);
    void drop(head.id);
    if (result.ok) {
      accept({ revision: result.revision, state: result.state });
      setError(null);
    } else {
      if (result.state && result.revision !== undefined) accept({ revision: result.revision, state: result.state });
      setError(errorText(result.error));
    }
    setQ(queueRef.current.filter((x) => x.id !== head.id));
    again.current();
  }, [p, accept, errorText, learnClock]);
  useEffect(() => {
    again.current = () => void pump();
  }, [pump]);

  // Other chairs' changes: read the committee every few seconds while nothing is being sent.
  const idle = queue.length === 0;
  useEffect(() => {
    if (!idle) return;
    const poll = p.poll;
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const sentAt = Date.now();
        const view = await poll();
        if (view) learnClock(view.now, sentAt);
        if (view && view.revision > revision.current && queueRef.current.length === 0) accept({ revision: view.revision, state: view.state });
      } catch {
        // Polling quietly retries on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [idle, p.poll, accept, learnClock]);

  const send = (command: Command) => {
    setError(null);
    const q = { id: crypto.randomUUID(), command };
    setQ([...queueRef.current, q]);
    // Kept on the device first, then sent.
    void keep(p.outboxKey, q).finally(() => void pump());
  };

  // Changes left unsent last time (the page was closed or reloaded): send them first.
  const outboxKey = p.outboxKey;
  useEffect(() => {
    let cancelled = false;
    void loadOutbox(outboxKey).then((left) => {
      if (cancelled || left.length === 0) return;
      const known = new Set(queueRef.current.map((x) => x.id));
      setQ([...left.filter((x) => !known.has(x.id)), ...queueRef.current]);
      again.current();
    });
    return () => {
      cancelled = true;
    };
  }, [outboxKey]);

  const counts = countsOf(pack, shown.attendance, ids);
  const quorum = quorumOf(pack, counts);
  const unanswered = ids.filter((id) => !shown.attendance[id]).length;
  const absent = pack.attendance.find((a) => !a.countsForQuorum)!;
  const session = shown.session;
  const rollCall = shown.rollCall;

  useShortcuts(!!session, shown, send);
  const shared = {
    state: shown,
    pack,
    delegates: p.delegates,
    vetoHolders: p.vetoHolders,
    documents: p.documents,
    locale,
    send,
    L,
  };
  const active = shown.caucus ? shown.caucus.list : shown.speakers;

  const sessionCard = (
    <section className="card flex flex-col gap-3" aria-labelledby="session-title">
            <h2 id="session-title" className="text-lg font-bold text-on-surface">
              {L.sessionTitle}
            </h2>
            {session ? (
              <>
                <p>
                  {fmt(L.sessionOpen, locale, {
                    number: session.number,
                    time: time.format(new Date(session.openedAt)),
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {confirmClose ? (
                    <>
                      <button type="button" className="btn btn-danger" onClick={() => (setConfirmClose(false), send({ type: 'session.close' }))}>
                        {fmt(L.closeConfirm, locale, {
                          number: session.number,
                        })}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setConfirmClose(false)} autoFocus>
                        {L.closeCancel}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmClose(true)}>
                      {L.close}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p>{L.noSession}</p>
                <div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      send({
                        type: 'session.open',
                        session: crypto.randomUUID(),
                      })
                    }
                    disabled={!idle}
                  >
                    {fmt(L.open, locale, { number: sessionsHeld + 1 })}
                  </button>
                </div>
              </>
            )}
          </section>
  );
  const quorumCard = (
    <section className="card flex flex-col gap-2" aria-labelledby="quorum-title">
            <h2 id="quorum-title" className="text-lg font-bold text-on-surface">
              {L.quorumTitle}
            </h2>
            <p className="text-2xl font-bold text-on-surface">
              {fmt(L.present, locale, {
                present: counts.present,
                members: counts.members,
              })}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                {fmt(L.quorumDebate, locale, {
                  needed: quorum.debate.needed,
                  met: quorum.debate.met ? 'yes' : 'no',
                })}
              </li>
              <li>
                {fmt(L.quorumVote, locale, {
                  needed: quorum.vote.needed,
                  met: quorum.vote.met ? 'yes' : 'no',
                })}
              </li>
            </ul>
          </section>
  );
  const rollCallCard = (
    <section className="card flex flex-col gap-3" aria-labelledby="rollcall-title">
              <h2 id="rollcall-title" className="text-lg font-bold text-on-surface">
                {L.rollCallTitle}
              </h2>
              {p.delegates.length === 0 ? <p className="text-sm">{L.empty}</p> : null}
              <p className="text-sm">
                {rollCall && !rollCall.finishedAt
                  ? L.running
                  : rollCall?.finishedAt
                    ? fmt(L.taken, locale, {
                        time: time.format(new Date(rollCall.finishedAt)),
                      })
                    : L.notStarted}{' '}
                {fmt(L.unanswered, locale, { count: unanswered })}
              </p>
              <div className="flex flex-wrap gap-2">
                {rollCall && !rollCall.finishedAt ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={unanswered === 0}
                      onClick={() =>
                        send({
                          type: 'attendance.fillUnmarked',
                          state: absent.key,
                        })
                      }
                    >
                      {fmt(L.fill, locale, {
                        state: nameOf(absent.name, locale),
                      })}
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => send({ type: 'rollcall.finish' })}>
                      {L.finish}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'rollcall.start' })}>
                    {rollCall ? L.startAgain : L.start}
                  </button>
                )}
              </div>
              <ul className="flex flex-col" aria-label={L.rollCallTitle}>
                {p.delegates.map((d) => {
                  const current = shown.attendance[d.id] ?? null;
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 border-b border-border py-2">
                      <Flag choice={d.flag} logoUrl={d.logoUrl} />
                      <span className="min-w-40 flex-1 font-semibold text-on-surface">{d.label}</span>
                      {pendingFor.has(d.id) ? <span className="text-xs text-on-surface-muted">{L.pendingOne}</span> : null}
                      <div role="group" aria-label={d.label} className="flex flex-wrap gap-1">
                        {pack.attendance.map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            aria-pressed={current === a.key}
                            title={nameOf(a.name, locale)}
                            className={`btn ${current === a.key ? 'btn-primary' : 'btn-secondary'} min-w-12`}
                            onClick={() =>
                              send({
                                type: 'attendance.set',
                                delegate: d.id,
                                state: current === a.key ? null : a.key,
                              })
                            }
                          >
                            <span aria-hidden="true">{a.short}</span>
                            <span className="sr-only">{nameOf(a.name, locale)}</span>
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
  );
  const status = (
    <p role="status" aria-live="polite" className={error ? 'error-text' : 'text-sm text-on-surface-muted'}>
      {error ?? (offline ? fmt(L.offline, locale, { count: queue.length }) : fmt(L.saving, locale, { count: queue.length }))}
    </p>
  );
  const bar = session && active ? <PhoneBar list={active} now={now} pack={pack} delegates={p.delegates} send={send} L={L} /> : null;

  if (p.layout === 'tabs') {
    const present = counts.present;
    const tabs: { id: ConsoleTab; label: string }[] = [
      { id: 'roll', label: fmt(L.tabRoll, locale, { present, total: counts.members }) },
      { id: 'floor', label: L.tabFloor! },
      { id: 'motions', label: fmt(L.tabMotions, locale, { count: shown.motions.length + shown.points.length }) },
      { id: 'voting', label: shown.vote ? `${L.tabVoting} •` : L.tabVoting! },
      { id: 'discipline', label: L.tabDiscipline! },
    ];
    return (
      <div className="flex flex-col gap-4 pb-28 xl:pb-0">
        <section className="card flex flex-wrap items-center gap-4" aria-label={L.sessionTitle}>
          <div className="min-w-0 flex-1">
            {p.committee.abbreviation ? <div className="label-text text-primary">{p.committee.abbreviation}</div> : null}
            <p className="truncate text-xl font-bold text-on-surface">{p.committee.name}</p>
            {p.committee.topic ? <p className="truncate text-sm">{p.committee.topic}</p> : null}
            {session ? null : <p className="mt-1 text-sm">{L.noSession}</p>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className={`badge ${session ? 'bg-primary text-on-primary' : 'border border-border-strong text-on-surface'}`}>{session ? L.inSession : L.notInSession}</span>
              {session ? <span className="badge border border-border-strong text-on-surface">{fmt(L.sessionBadge, locale, { number: session.number })}</span> : null}
              {session ? <span className="badge border border-border text-on-surface">{shown.vote ? L.tabVoting : shown.caucus ? nameOf(pack.caucuses.find((c) => c.key === shown.caucus!.key)?.name ?? {}, locale) || shown.caucus.key : L.general}</span> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {session ? (
                confirmClose ? (
                  <>
                    <button type="button" className="btn btn-danger" onClick={() => (setConfirmClose(false), send({ type: 'session.close' }))}>
                      {fmt(L.closeConfirm, locale, { number: session.number })}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmClose(false)} autoFocus>
                      {L.closeCancel}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmClose(true)}>
                    {L.close}
                  </button>
                )
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => send({ type: 'session.open', session: crypto.randomUUID() })} disabled={!idle}>
                  {fmt(L.open, locale, { number: sessionsHeld + 1 })}
                </button>
              )}
            </div>
          </div>
        </section>
        {status}
        {session ? (
          <>
            <div role="tablist" aria-label={L.tabsLabel} className="tabs">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} className="tab" onClick={() => chooseTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-6">
              {tab === 'roll' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
                  {rollCallCard}
                  {quorumCard}
                </div>
              ) : null}
              {tab === 'floor' ? <Floor state={shown} pack={pack} delegates={p.delegates} now={now} locale={locale} send={send} L={L} /> : null}
              {tab === 'motions' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                  <MotionsPanel {...shared} />
                  <PointsPanel {...shared} />
                </div>
              ) : null}
              {tab === 'voting' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
                  <VotePanel key={shown.vote?.id ?? 'none'} {...shared} />
                  {quorumCard}
                </div>
              ) : null}
              {tab === 'discipline' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                  <DisciplinePanel {...shared} />
                  <Shortcuts L={L} />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          quorumCard
        )}
        {bar}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-28 xl:pb-0">
      {status}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {sessionCard}
          {session ? (
            <>
              <Floor state={shown} pack={pack} delegates={p.delegates} now={now} locale={locale} send={send} L={L} />
              <VotePanel key={shown.vote?.id ?? 'none'} {...shared} />
              <MotionsPanel {...shared} />
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {quorumCard}
          {session ? <PointsPanel {...shared} /> : null}
          {session ? rollCallCard : null}
          <DisciplinePanel {...shared} />
          <Shortcuts L={L} />
        </div>
      </div>

      {bar}
    </div>
  );
}
