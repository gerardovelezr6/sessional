import { describe, expect, it, vi } from 'vitest';
import { standardGrading } from '@/grading/presets';
import { gradingSchema, type Grading } from '@/grading/schema';
import { awardSuggestions, shownTotal, standingsOf, type GradingData } from '@/grading/standings';

vi.mock('server-only', () => ({}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [MX, FR, KE] = [id(1), id(2), id(3)];
const [S1, S2] = [id(11), id(12)];
const g = (n: number, delegate: string, session: string | null, category: string, points: number, weight = 1) => ({
  id: id(100 + n), session_id: session, delegate_id: delegate, label: '', category, category_name: { en: category }, level: 'l', level_label: { en: 'l' }, points: String(points), weight: String(weight), note: '', graded_at: `2027-03-01T09:${String(n).padStart(2, '0')}:00Z`, graded_by: 'Chair',
});
const base: GradingData = {
  committee: { id: id(50), name: 'Council', abbreviation: 'SC', type_key: 'standard' },
  delegates: [{ id: MX, label: 'Mexico', name: 'Ana' }, { id: FR, label: 'France', name: '' }, { id: KE, label: 'Kenya', name: '' }],
  sessions: [{ id: S1, number: 1 }, { id: S2, number: 2 }],
  grades: [],
  speeches: [],
  explanations: [],
  present: [],
  awards: [],
};

// The reference app's grading log, expressed as settings only: six categories with numbered levels
// (speech 6/5/4/3, question 3/2/1, moderated caucus 3/2/1, unmoderated 3/2/1, working paper and
// resolution paper), one point per explanation of vote, totals per session and overall, four
// awards. Neutral wording; only the structure and the numbers matter here.
const REFERENCE: Grading = gradingSchema.parse({
  categories: [
    { key: 'sl_speech', name: { en: 'Speakers list: speech' }, short: 'SL', levels: [6, 5, 4, 3].map((p) => ({ key: `p${p}`, label: { en: String(p) }, points: p })) },
    { key: 'sl_question', name: { en: 'Speakers list: question' }, short: 'SL Q', levels: [3, 2, 1].map((p) => ({ key: `p${p}`, label: { en: String(p) }, points: p })) },
    { key: 'mc', name: { en: 'Moderated caucus' }, short: 'MC', levels: [3, 2, 1].map((p) => ({ key: `p${p}`, label: { en: String(p) }, points: p })) },
    { key: 'umc', name: { en: 'Unmoderated caucus' }, short: 'UMC', levels: [3, 2, 1].map((p) => ({ key: `p${p}`, label: { en: String(p) }, points: p })) },
    { key: 'wp', name: { en: 'Working paper' }, short: 'WP', levels: [3, 2, 1].map((p) => ({ key: `p${p}`, label: { en: String(p) }, points: p })) },
    { key: 'rp', name: { en: 'Resolution paper' }, short: 'RP', levels: [3, 2, 1].map((p) => ({ key: `p${p}`, label: { en: String(p) }, points: p })) },
  ],
  bonuses: [{ key: 'explanation', name: { en: 'Explanation of vote' }, source: 'vote_explanation', points: 1 }],
  awards: [
    { key: 'best', name: { en: 'Best Delegate' } },
    { key: 'outstanding', name: { en: 'Outstanding Delegate' } },
    { key: 'mention', name: { en: 'Honorific Mention' } },
    { key: 'paper', name: { en: 'Best Position Paper' }, rule: 'manual' },
  ],
});

describe('the reference grading log, from settings alone', () => {
  it('totals per session and overall: grades plus a point per explanation of vote', () => {
    const data: GradingData = {
      ...base,
      grades: [g(1, MX, S1, 'sl_speech', 6), g(2, MX, S1, 'mc', 3), g(3, FR, S1, 'sl_question', 2), g(4, MX, S2, 'rp', 3), g(5, FR, S2, 'umc', 3), g(6, KE, S2, 'sl_speech', 4)],
      // Explanations given in two votes of session 2.
      explanations: [{ delegate_id: FR, session_id: S2 }, { delegate_id: FR, session_id: S2 }, { delegate_id: KE, session_id: S2 }],
    };
    const rows = standingsOf(REFERENCE, data);
    expect(rows.map((r) => [r.label, r.bySession[S1], r.bySession[S2], r.byBonus.explanation, r.total, r.rank])).toEqual([
      ['Mexico', 9, 3, 0, 12, 1],
      ['France', 2, 5, 2, 7, 2],
      ['Kenya', 0, 5, 1, 5, 3],
    ]);
    expect(rows[0]!.byCategory).toMatchObject({ sl_speech: 6, mc: 3, rp: 3 });
    // The leaderboard suggests the awards in order; the paper award is left to the chair.
    expect(awardSuggestions(REFERENCE, rows)).toEqual({ best: [MX], outstanding: [FR], mention: [KE], paper: [] });
  });
});

describe('standings', () => {
  it('weights, half points and ties', () => {
    const rows = standingsOf(standardGrading(), { ...base, grades: [g(1, MX, S1, 'speech', 4.5, 2), g(2, FR, S1, 'speech', 4.5, 2), g(3, KE, null, 'papers', 0.5)] });
    expect(rows.map((r) => [r.label, r.total, r.rank])).toEqual([
      ['France', 9, 1],
      ['Mexico', 9, 1],
      ['Kenya', 0.5, 3],
    ]);
    // A grade without a session still counts in the total.
    expect(rows[2]!.bySession['']).toBe(0.5);
  });
  it('speech and presence bonuses come from the floor records', () => {
    const rules = { ...standardGrading(), bonuses: [{ key: 'spoke', name: { en: 'Spoke' }, source: 'speech' as const, points: 0.5 }, { key: 'here', name: { en: 'Here' }, source: 'present' as const, points: 1 }] };
    const rows = standingsOf(rules, { ...base, speeches: [{ delegate_id: MX, session_id: S1, count: '3' }], present: [{ delegate_id: MX, session_id: S1 }, { delegate_id: MX, session_id: S2 }] });
    expect(rows[0]).toMatchObject({ label: 'Mexico', byBonus: { spoke: 1.5, here: 2 }, total: 3.5 });
  });
  it('a removed delegate keeps their graded line', () => {
    const rows = standingsOf(standardGrading(), { ...base, delegates: [], grades: [{ ...g(1, id(9), S1, 'speech', 4), label: 'Old Name' }] });
    expect(rows.map((r) => r.label)).toEqual(['Old Name']);
  });
  it.each([
    [{ kind: 'points' as const, max: 100, letters: [] }, 12.5, '12.5'],
    [{ kind: 'percent' as const, max: 40, letters: [] }, 30, '75%'],
    [{ kind: 'percent' as const, max: 40, letters: [] }, 50, '100%'],
    [{ kind: 'letters' as const, max: 40, letters: [{ min: 90, label: 'A' }, { min: 75, label: 'B' }, { min: 0, label: 'C' }] }, 30, 'B'],
  ])('shows totals on the school\'s scale (%o, %s → %s)', (scale, total, shown) => {
    expect(shownTotal(total, scale)).toBe(shown);
  });
  it('the standard rubric is valid in English and Spanish', () => {
    const r = gradingSchema.safeParse(standardGrading());
    expect(r.success).toBe(true);
    for (const c of standardGrading().categories) for (const l of c.levels) expect(Object.keys(l.label).sort()).toEqual(['en', 'es']);
  });
  it('refuses points that are not in steps of a half, and repeated keys', () => {
    const bad = standardGrading();
    bad.categories[0]!.levels[0]!.points = 1.25;
    expect(gradingSchema.safeParse(bad).success).toBe(false);
    const twice = standardGrading();
    twice.categories.push(twice.categories[0]!);
    expect(gradingSchema.safeParse(twice).success).toBe(false);
  });
});

describe('exports', () => {
  const data: GradingData = { ...base, grades: [g(1, MX, S1, 'speech', 5), g(2, FR, S2, 'question', 2)], awards: [{ award: 'best', award_name: { en: 'Best Delegate' }, delegate_id: MX, label: 'Mexico' }] };
  const words = { committee: 'Committee', rank: 'Rank', label: 'Country', name: 'Student', session: 'Session {number}', total: 'Total', shown: 'Grade', awards: 'Awards' };

  it('a saved mapping chooses, orders and renames columns, and re-exports identically', async () => {
    const { applyMapping, availableColumns, gradebookRows, toCsv } = await import('@/grading/export');
    const rules = standardGrading();
    const columns = applyMapping(availableColumns(rules, [1, 2], 'en', words), [
      { key: 'label', header: 'Delegation' },
      { key: 'total', header: '' },
      { key: 'session:2' },
      { key: 'no_such_column', header: 'x' },
      { key: 'awards', header: 'Prize' },
    ]);
    expect(columns).toEqual([
      { key: 'label', header: 'Delegation' },
      { key: 'total', header: 'Total' },
      { key: 'session:2', header: 'Session 2' },
      { key: 'awards', header: 'Prize' },
    ]);
    const rows = gradebookRows(data, standingsOf(rules, data), 'Council');
    const first = toCsv(columns, rows);
    expect(first).toBe('﻿Delegation,Total,Session 2,Prize\r\nMexico,5,0,Best Delegate\r\nFrance,2,2,\r\nKenya,0,0,\r\n');
    expect(toCsv(columns, gradebookRows(data, standingsOf(rules, data), 'Council'))).toBe(first);
  });
  it('quotes commas and quotes, and never lets a cell run as a formula', async () => {
    const { toCsv } = await import('@/grading/export');
    expect(toCsv([{ key: 'a', header: 'A' }], [{ a: 'Côte d\'Ivoire, "CIV"' }, { a: '=HYPERLINK("x")' }, { a: -3 }])).toBe('﻿A\r\n"Côte d\'Ivoire, ""CIV"""\r\n"\'=HYPERLINK(""x"")"\r\n-3\r\n');
  });
  it('the Excel workbook holds the same rows, and the same data gives the same cells', async () => {
    const { applyMapping, availableColumns, gradebookRows, toXlsx } = await import('@/grading/export');
    const ExcelJS = (await import('exceljs')).default;
    const rules = standardGrading();
    const columns = applyMapping(availableColumns(rules, [1, 2], 'en', words), null);
    const book = { title: 'Council', columns, rows: gradebookRows(data, standingsOf(rules, data), 'Council'), log: { header: ['When'], rows: [['2027-03-01']] }, rubric: { header: ['Level'], rows: [['Good']] }, sheetNames: { gradebook: 'Gradebook', log: 'Log', rubric: 'Rubric' }, asOf: new Date('2027-03-01T10:00:00Z') };
    const read = async (buf: Buffer) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      return wb.worksheets.map((ws) => [ws.name, ws.getSheetValues().map((r) => (Array.isArray(r) ? r.slice(1) : r))]);
    };
    const a = await read(await toXlsx(book));
    expect(a.map((s) => s[0])).toEqual(['Gradebook', 'Log', 'Rubric']);
    expect((a[0]![1] as unknown[][])[1]).toEqual(columns.map((c) => c.header));
    expect(await read(await toXlsx(book))).toEqual(a);
  });
  it('the PDF is the same file for the same data, and prints accents', async () => {
    const { toPdf } = await import('@/grading/export');
    const input = { title: 'Consejo de Seguridad', subtitle: 'Señal · 2027', columns: [{ key: 'label', header: 'País' }, { key: 'total', header: 'Total' }], rows: [{ label: 'Côte d’Ivoire', total: 5 }, { label: 'México', total: 4.5 }], brand: '#1E40AF', onBrand: '#FFFFFF' };
    const a = await toPdf(input);
    const b = await toPdf(input);
    expect(Buffer.from(a).subarray(0, 5).toString()).toBe('%PDF-');
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});
