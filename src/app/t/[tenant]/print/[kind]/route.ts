import { NextResponse } from 'next/server';
import { moduleOn } from '@/config/modules';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { gradingRulesOf } from '@/grading/rules';
import { loadGrading } from '@/grading/server';
import { standingsOf } from '@/grading/standings';
import { assetUrl } from '@/data/storage';
import { localize } from '@/messages';
import { brandOf } from '@/print/brand';
import { flagPng } from '@/print/flags';
import { flagFor } from '@/structure/flags';
import { typeOf } from '@/structure/schema';
import { checkinCode } from '@/print/checkin';
import { agenda, certificates, placards, resolutions, signInSheets } from '@/print/kinds';
import { currentSchedule } from '@/schedule/load';
import { dayIn, timeIn } from '@/schedule/time';
import { requireTenant, tenantContext, tenantOrigin } from '@/tenancy/context';
import { loadCommittee, loadOverview, UUID, type CommitteeDetail } from '../../committees/data';
import type { DocumentRow } from '../../committees/[id]/documents/rules';

// Printables as PDF, in the school's look. What a person may print follows what they may read:
// the database decides which committees, delegations, documents and grades come back.
//   /print/placards?committee=all|<id>     tent cards with a check-in QR code
//   /print/signin?committee=…&sessions=4   sign-in sheets
//   /print/agenda                          the schedule
//   /print/resolutions?committee=…         passed resolutions
//   /print/certificates?type=participation|awards&committee=…
//   /print/grades                          the gradebook PDF (the grades export)

export const dynamic = 'force-dynamic';
const KINDS = ['placards', 'signin', 'agenda', 'resolutions', 'certificates', 'grades'] as const;
type Kind = (typeof KINDS)[number];

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'print';

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; kind: string }> }) {
  const { tenant: key, kind: raw } = await params;
  const kind = KINDS.find((k) => k === raw) as Kind | undefined;
  const tenant = await requireTenant(key);
  const ctx = await tenantContext(tenant.id);
  if (!ctx) return new NextResponse(null, { status: 401 });
  if (!kind || !ctx.membership) return new NextResponse(null, { status: 404 });
  const url = new URL(req.url);
  if (kind === 'grades') {
    if (!ctx.can('grades.view')) return new NextResponse(null, { status: 403 });
    return NextResponse.redirect(`${await tenantOrigin()}/grades/export?committee=all&format=pdf`, 303);
  }

  const { t, locale, config } = await tenantTranslator(tenant.id);
  const which = url.searchParams.get('committee') ?? 'all';
  if (which !== 'all' && !UUID.test(which)) return new NextResponse(null, { status: 400 });
  const runsCommittees = ctx.can('committee.manage') || ctx.can('committee.run');
  const overview = await loadOverview(tenant.id, ctx.token);
  const conferenceName = overview.conference?.name ?? '';
  const brand = await brandOf(tenant, config);
  const committees = async (): Promise<CommitteeDetail[]> => {
    const ids = overview.committees.filter((c) => which === 'all' || c.id === which).map((c) => c.id);
    return (await Promise.all(ids.map((id) => loadCommittee(tenant.id, id, ctx.token)))).filter((d): d is CommitteeDetail => !!d);
  };
  const pr = config.printing;
  // A delegation's flag as the app shows it (country, US state or group logo), as an image.
  const flagOf = (d: CommitteeDetail, x: CommitteeDetail['delegates'][number]) => {
    const type = typeOf(config.structure, d.committee.type_key);
    const logo = x.group_key ? assetUrl(tenant.id, type.groups.find((g) => g.key === x.group_key)?.logo) : null;
    return flagPng(flagFor(type, x, [locale]), logo);
  };
  const nameOf = (c: CommitteeDetail['committee']) => (c.abbreviation ? `${c.abbreviation} · ${c.name}` : c.name);

  let body: Uint8Array;
  let title: string;
  switch (kind) {
    case 'placards': {
      if (!runsCommittees) return new NextResponse(null, { status: 403 });
      const list = await committees();
      const origin = await tenantOrigin();
      title = t('print.placards.title');
      const flags = pr.placardFlag === 'on';
      const items = await Promise.all(
        list.flatMap((d) =>
          d.delegates.map(async (x) => ({
            committee: nameOf(d.committee),
            label: x.label,
            flag: flags ? await flagOf(d, x) : null,
            checkin: pr.placardQr === 'on' ? `${origin}/checkin/${checkinCode(d.committee.id, x.id)}` : null,
          })),
        ),
      );
      body = await placards(brand, title, items, { style: pr.placardStyle, color: pr.placardColor ?? brand.primary, logo: pr.placardLogo === 'on', committee: pr.placardCommittee === 'on' });
      break;
    }
    case 'signin': {
      if (!runsCommittees) return new NextResponse(null, { status: 403 });
      const sessions = Math.min(8, Math.max(1, Number(url.searchParams.get('sessions')) || 4));
      title = t('print.signin.title');
      body = await signInSheets(
        brand,
        title,
        (await committees()).map((d) => ({ name: nameOf(d.committee), delegations: d.delegates.map((x) => ({ label: x.label, name: x.name })) })),
        sessions,
        { delegation: t('print.signin.delegation'), name: t('print.signin.name'), session: (n) => t('print.signin.session', { number: n }) },
      );
      break;
    }
    case 'agenda': {
      if (!moduleOn(config, 'schedule')) return new NextResponse(null, { status: 404 });
      const tz = config.identity.timeZone;
      const { items } = await currentSchedule(tenant.id, ctx.token);
      const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      const days = [...new Set(items.map((i) => dayIn(i.starts_at, tz)))].sort();
      title = t('print.agenda.title');
      body = await agenda(
        brand,
        title,
        conferenceName,
        days.map((day) => ({
          day: dayName.format(new Date(`${day}T12:00:00Z`)),
          items: items.filter((i) => dayIn(i.starts_at, tz) === day).map((i) => ({ time: `${timeIn(i.starts_at, tz)}–${timeIn(i.ends_at, tz)}`, title: i.title, detail: i.location })),
        })),
      );
      break;
    }
    case 'resolutions': {
      if (!moduleOn(config, 'documents')) return new NextResponse(null, { status: 404 });
      if (!runsCommittees) return new NextResponse(null, { status: 403 });
      const list = overview.committees.filter((c) => which === 'all' || c.id === which);
      const docs = await Promise.all(list.map(async (c) => ({ c, docs: await rpc<DocumentRow[]>('documents_list', { p_committee: c.id }, { token: ctx.token }).catch(() => []) })));
      title = t('print.resolutions.title');
      body = await resolutions(
        brand,
        title,
        docs.flatMap(({ c, docs: ds }) => ds.filter((d) => d.status === 'passed' && !d.parent_id).map((d) => ({ committee: c.abbreviation ? `${c.abbreviation} · ${c.name}` : c.name, code: d.code, title: d.title, body: d.body }))),
        t('print.resolutions.none'),
      );
      break;
    }
    case 'certificates': {
      const awards = url.searchParams.get('type') === 'awards';
      if (awards ? !ctx.can('grades.view') : !ctx.can('committee.manage')) return new NextResponse(null, { status: 403 });
      const list = await committees();
      title = t(awards ? 'print.certificates.awards' : 'print.certificates.participation');
      const flags = pr.certificateFlag === 'on';
      const items: { name: string; line: string; flag: Uint8Array | null }[] = [];
      if (awards) {
        const rules = gradingRulesOf(config);
        for (const d of list) {
          const data = await loadGrading(d.committee.id, ctx.token);
          if (!data) continue;
          for (const s of standingsOf(rules, data, locale)) {
            const who = d.delegates.find((x) => x.id === s.delegateId);
            for (const a of s.awards) items.push({ name: s.name || s.label, line: t('print.certificates.awardLine', { award: a, delegation: s.label, committee: d.committee.name }), flag: flags && who ? await flagOf(d, who) : null });
          }
        }
      } else {
        for (const d of list) for (const x of d.delegates) items.push({ name: x.name || x.label, line: t('print.certificates.participationLine', { delegation: x.label, committee: d.committee.name }), flag: flags ? await flagOf(d, x) : null });
      }
      const own = (v: Record<string, string>) => localize(v, locale, '');
      const heading = own(awards ? pr.certificateAwardTitle : pr.certificateTitle) || t(awards ? 'print.certificates.awardHeading' : 'print.certificates.heading');
      body = await certificates(brand, title, heading, items, {
        style: pr.certificateStyle,
        color: pr.certificateColor ?? brand.primary,
        logo: pr.certificateLogo === 'on',
        note: own(pr.certificateNote) || conferenceName,
        signers: ([1, 2, 3] as const).map((n) => ({ name: own(pr[`signer${n}Name`]), role: own(pr[`signer${n}Role`]) })),
      });
      break;
    }
  }
  // Ids and counts only: never names.
  console.info(JSON.stringify({ event: 'print', tenant: tenant.id, kind, committees: which === 'all' ? 'all' : 1 }));
  return new NextResponse(body as BodyInit, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${slug(title)}.pdf"`, 'cache-control': 'no-store' },
  });
}
