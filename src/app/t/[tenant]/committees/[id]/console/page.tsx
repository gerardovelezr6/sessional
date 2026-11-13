import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { Shell } from "@/components/Shell";
import { enabledLocales, tenantTranslator } from "@/config/store";
import { rpc } from "@/data/rpc";
import { assetUrl } from "@/data/storage";
import { localize, messageFor, type MessageKey } from "@/messages";
import { readState } from "@/protocol/engine";
import { protocolFor } from "@/protocol/run";
import { clock } from "@/protocol/timer";
import { flagFor } from "@/structure/flags";
import { typeOf } from "@/structure/schema";
import { basePath, requireTenant, tenantContext } from "@/tenancy/context";
import { loadCommittee, serverTime } from "../../data";
import { liveViewAction, runCommandAction } from "./actions";
import { Console } from "./Console";

interface SessionRow {
  id: string;
  number: number;
  opened_at: string;
  closed_at: string | null;
  roll_calls: {
    id: string;
    taken_at: string;
    entries: { state: string; state_name: Record<string, string> }[];
  }[];
  speeches: { seconds: number }[];
}

export default async function ConsolePage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant: key, id } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  const detail = await loadCommittee(tenant.id, id, ctx.token);
  if (!detail) notFound();
  const canRun = await rpc<boolean>(
    "committee_can_run",
    { p_committee: id },
    { token: ctx.token },
  );
  if (!canRun)
    return (
      <Notice
        title={t("forbidden.title")}
        body={t("forbidden.body")}
        locale={locale}
      />
    );

  const view = await rpc<{
    revision: number;
    state: unknown;
    session: { protocol: unknown } | null;
  }>("live_view", { p_committee: id }, { token: ctx.token });
  const sessions = await rpc<SessionRow[]>(
    "committee_sessions_list",
    { p_committee: id },
    { token: ctx.token },
  );
  const { committee } = detail;
  const type = typeOf(config.structure, committee.type_key);
  const languages = enabledLocales(config);
  const committeeLocale = committee.language ?? config.locale.defaultLocale;
  const nextProtocol = protocolFor(null, config.protocol.preset);
  const protocol = protocolFor(view.session?.protocol, config.protocol.preset);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: config.identity.timeZone,
  });
  const pattern = (k: MessageKey) =>
    messageFor(k, locale, config.translations.messages).text;

  return (
    <Shell
      title={t("console.title", { name: committee.name })}
      size="wide"
      locale={locale}
    >
      <div className="flex flex-col gap-6">
        <p>
          <Link
            href={`${base}/committees/${committee.id}`}
            className="text-sm font-semibold underline underline-offset-2"
          >
            {t("console.back")}
          </Link>
        </p>
        <Console
          initial={{ revision: view.revision, state: readState(view.state) }}
          protocol={protocol}
          nextProtocol={nextProtocol}
          sessionsHeld={sessions.length}
          delegates={detail.delegates.map((d) => ({
            id: d.id,
            label: d.label,
            flag: flagFor(type, d, [committeeLocale, ...languages]),
            logoUrl: d.group_key
              ? assetUrl(
                  tenant.id,
                  type.groups.find((g) => g.key === d.group_key)?.logo,
                )
              : null,
          }))}
          serverNow={serverTime()}
          locale={locale}
          timeZone={config.identity.timeZone}
          run={runCommandAction.bind(null, key, committee.id)}
          poll={liveViewAction.bind(null, key, committee.id)}
          L={{
            saving: pattern("console.saving"),
            offline: pattern("console.offline"),
            pendingOne: t("console.pending"),
            sessionTitle: t("console.session.title"),
            sessionOpen: pattern("console.session.open"),
            noSession: t("console.session.none"),
            open: pattern("console.session.start"),
            close: t("console.session.close"),
            closeConfirm: pattern("console.session.close.confirm"),
            closeCancel: t("console.session.close.cancel"),
            quorumTitle: t("console.quorum.title"),
            present: pattern("console.quorum.present"),
            quorumDebate: pattern("console.quorum.debate"),
            quorumVote: pattern("console.quorum.vote"),
            rollCallTitle: t("console.rollcall.title"),
            running: t("console.rollcall.running"),
            taken: pattern("console.rollcall.taken"),
            notStarted: t("console.rollcall.notStarted"),
            unanswered: pattern("console.rollcall.unanswered"),
            fill: pattern("console.rollcall.fill"),
            finish: t("console.rollcall.finish"),
            start: t("console.rollcall.start"),
            startAgain: t("console.rollcall.again"),
            empty: t("console.empty"),
            error_failed: t("console.error.failed"),
            error_forbidden: t("committees.error.forbidden"),
            error_conflict: t("console.error.conflict"),
            error_session_open: t("console.error.session_open"),
            error_no_session: t("console.error.no_session"),
            error_no_roll_call: t("console.error.no_roll_call"),
            error_unknown_delegate: t("console.error.unknown_delegate"),
            error_unknown_state: t("console.error.unknown_state"),
            add: t("floor.add"),
            almost: t("floor.almost"),
            caucusEnd: t("floor.caucus.end"),
            caucusEndCancel: t("floor.caucus.end.cancel"),
            caucusEndConfirm: t("floor.caucus.end.confirm"),
            caucusLeft: t("floor.caucus.left"),
            caucusList: t("floor.caucusList"),
            caucusPause: t("floor.caucus.pause"),
            caucusResume: t("floor.caucus.resume"),
            caucusSeconds: t("floor.caucus.seconds"),
            caucusStart: t("floor.caucus.start"),
            caucusTitle: t("floor.caucus.title"),
            caucusTopic: t("floor.caucus.topic"),
            caucusType: t("floor.caucus.type"),
            endSpeech: t("floor.endSpeech"),
            extend: t("floor.caucus.extend"),
            extendBy: t("floor.caucus.extendBy"),
            general: t("floor.general"),
            generalList: t("floor.generalList"),
            listEmpty: t("floor.listEmpty"),
            next: t("floor.next"),
            noCaucuses: t("floor.caucus.none"),
            nobody: t("floor.nobody"),
            noneToAdd: t("floor.noneToAdd"),
            pause: t("floor.pause"),
            paused: t("floor.paused"),
            ready: t("floor.ready"),
            removed: t("floor.removed"),
            reset: t("floor.reset"),
            resume: t("floor.resume"),
            search: t("floor.search"),
            speaking: t("floor.speaking"),
            speakingTime: t("floor.speakingTime"),
            timeLeft: t("floor.timeLeft"),
            timeUp: t("floor.timeUp"),
            timerRunning: t("floor.running"),
            timerStart: t("floor.start"),
            unmoderated: t("floor.unmoderated"),
            up: pattern("floor.up"),
            down: pattern("floor.down"),
            remove: pattern("floor.remove"),
            minutes: pattern("floor.caucus.minutes"),
            error_not_present: t("console.error.not_present"),
            error_already_listed: t("console.error.already_listed"),
            error_not_listed: t("console.error.not_listed"),
            error_list_empty: t("console.error.list_empty"),
            error_no_speaker: t("console.error.no_speaker"),
            error_no_list: t("console.error.no_list"),
            error_caucus_running: t("console.error.caucus_running"),
            error_no_caucus: t("console.error.no_caucus"),
            error_unknown_caucus: t("console.error.unknown_caucus"),
            error_too_long: t("console.error.too_long"),
            error_no_extensions: t("console.error.no_extensions"),
          }}
        />

        <section
          className="card flex flex-col gap-3"
          aria-labelledby="sessions-title"
        >
          <h2 id="sessions-title" className="text-lg font-bold text-on-surface">
            {t("console.sessions.title")}
          </h2>
          {sessions.length === 0 ? (
            <p className="text-sm">{t("console.sessions.empty")}</p>
          ) : null}
          <ul
            className="flex flex-col gap-3"
            aria-label={t("console.sessions.title")}
          >
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 border-b border-border pb-2"
              >
                <span className="font-semibold text-on-surface">
                  {s.closed_at
                    ? t("console.sessions.closed", {
                        number: s.number,
                        from: when.format(new Date(s.opened_at)),
                        to: when.format(new Date(s.closed_at)),
                      })
                    : t("console.sessions.open", {
                        number: s.number,
                        from: when.format(new Date(s.opened_at)),
                      })}
                </span>
                {s.speeches.length ? (
                  <span className="text-sm">
                    {t("console.sessions.speeches", {
                      count: s.speeches.length,
                      time: clock(
                        s.speeches.reduce((n, x) => n + x.seconds, 0) * 1000,
                      ),
                    })}
                  </span>
                ) : null}
                {s.roll_calls.map((r) => {
                  // Counted by the names the answers had at the time.
                  const tally = new Map<string, number>();
                  for (const e of r.entries) {
                    const name = localize(e.state_name, locale, e.state);
                    tally.set(name, (tally.get(name) ?? 0) + 1);
                  }
                  return (
                    <span key={r.id} className="text-sm">
                      {t("console.sessions.rollcall", {
                        time: when.format(new Date(r.taken_at)),
                        counts:
                          [...tally]
                            .map(([name, n]) => `${name} ${n}`)
                            .join(" · ") || "—",
                      })}
                    </span>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}
