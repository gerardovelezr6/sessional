import { describe, expect, it, vi } from 'vitest';
import { detectLayout, errorReport, planImport, type CommitteeRef, type Layout } from '@/import/plan';
import { parseCsv, sheetsExportUrl, type Sheet } from '@/import/table';
import { standardStructure } from '@/structure/presets';

vi.mock('server-only', () => ({}));

const structure = standardStructure();
const committees: CommitteeRef[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Security Council', abbreviation: 'SC', type_key: 'standard', labels: ['Brazil'] },
  { id: '00000000-0000-4000-8000-000000000002', name: 'World Health Organization', abbreviation: 'WHO', type_key: 'standard', labels: [] },
  { id: '00000000-0000-4000-8000-000000000003', name: 'International Atomic Energy Agency', abbreviation: 'IAEA', type_key: 'standard', labels: [] },
];
const plan = (sheets: Sheet[], createCommittees = false, change: (l: Layout) => Layout = (l) => l) =>
  planImport({ sheets, layouts: sheets.map((s, i) => change(detectLayout(s, i, committees, sheets.length === 1))), committees, structure, createCommittees });

describe('reading CSV', () => {
  it('handles quotes, doubled quotes, line breaks in cells and a byte-order mark; blank lines keep their place', () => {
    const text = '﻿Committee,Country,Name\r\nSC,"Korea, Republic of","Ana ""Ani"" Souza"\n\nWHO,"Côte\nd’Ivoire",\n\n';
    expect(parseCsv(text)).toEqual([['Committee', 'Country', 'Name'], ['SC', 'Korea, Republic of', 'Ana "Ani" Souza'], [], ['WHO', 'Côte\nd’Ivoire', '']]);
  });
  it('detects semicolons and tabs', () => {
    expect(parseCsv('Comité;País\nCS;México')).toEqual([['Comité', 'País'], ['CS', 'México']]);
    expect(parseCsv('a\tb, c\n1\t2')).toEqual([['a', 'b, c'], ['1', '2']]);
  });
});

describe('Google Sheets links', () => {
  it('become the Excel download of the whole spreadsheet, from Google only', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(sheetsExportUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`)).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
    for (const bad of [`http://docs.google.com/spreadsheets/d/${id}`, `https://docs.google.com.evil.test/spreadsheets/d/${id}`, `https://evil.test/?u=https://docs.google.com/spreadsheets/d/${id}`, 'not a link', `https://docs.google.com/document/d/${id}`]) {
      expect(sheetsExportUrl(bad), bad).toBeNull();
    }
  });

  it('are fetched without following redirects off Google, and private sheets are named as such', async () => {
    const { readSheets } = await import('@/import/read');
    const link = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';
    const asked: string[] = [];
    const ok = (async (url: string) => {
      asked.push(url);
      if (url.startsWith('https://docs.google.com/')) return new Response(null, { status: 307, headers: { location: 'https://doc-0s-sheets.googleusercontent.com/export/abc' } });
      return new Response('Committee,Country\nSC,Brazil\n', { headers: { 'content-type': 'text/csv' } });
    }) as unknown as typeof fetch;
    expect(await readSheets(link, ok)).toEqual({ sheets: [{ name: 'Google Sheets', rows: [['Committee', 'Country'], ['SC', 'Brazil']] }], source: 'sheets' });
    expect(asked[1]).toMatch(/^https:\/\/doc-0s-sheets\.googleusercontent\.com\//);
    const signIn = (async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } })) as unknown as typeof fetch;
    expect(await readSheets(link, signIn)).toEqual({ error: 'sheets_private' });
    const away = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } })) as unknown as typeof fetch;
    expect(await readSheets(link, away)).toEqual({ error: 'sheets_failed' });
    const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    expect(await readSheets(link, html)).toEqual({ error: 'sheets_private' });
    expect(await readSheets('https://evil.test/sheet', ok)).toEqual({ error: 'not_sheets' });
  });
});

describe('reading a tab', () => {
  it('recognises headings in either language on the first row', () => {
    expect(detectLayout({ name: 'x', rows: [['Nombre del delegado', 'Comité', 'País']] }, 0, committees)).toMatchObject({ headerRow: 0, mapping: { committee: 1, label: 2, name: 0, group: null }, skip: false });
  });

  // Laid out the way schools keep their committee sheets: a title, a subtitle, a legend beside the
  // list, headings on row 4, numbered rows left blank, a totals row and a side list further right.
  const tracker = (): Sheet => {
    const rows: string[][] = [
      ['', '', '', '', '', 'Committee: IAEA'],
      ['', '', '', '', '', 'Model UN 2026'],
      ['', '', '', '', '', '', '', 'Sessions', '', '', 'Notes', 'Points', 'Winners'],
      ['', '', 'Key', '', '', '#', 'Delegation', '1', '2', '3', '', '#', 'Best Delegate: Kenya'],
      ['', '', 'TRUE', 'On time', '', '1', 'Arab Republic of Egypt', 'TRUE', 'TRUE', 'TRUE', '', '89'],
      ['', '', 'TRUE', 'Late', '', '2', 'Hashemite Kingdom of Jordan', 'TRUE', 'TRUE', 'FALSE', 'late twice', '12'],
      ['', '', '', '', '', '3', 'Swiss Confederation', 'TRUE', 'TRUE', 'TRUE', '', '40'],
      ['', '', '', '', '', '4', 'Kenya', 'TRUE', 'TRUE', 'TRUE', '', '70'],
      ['', '', '', '', '', '5', '', 'FALSE', 'FALSE', 'FALSE', '', '0'],
      ['', '', '', '', '', '6', '', 'FALSE', 'FALSE', 'FALSE', '', '0'],
      ['', '', '', '', '', '', '', '4', '4', '3'],
      [],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', 'Other countries'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', 'Kingdom of Spain'],
    ];
    return { name: 'Sheet1', rows };
  };

  it('finds the headings below a title, the committee in the title, and skips blank, total and side rows', () => {
    const layout = detectLayout(tracker(), 0, committees);
    expect(layout).toMatchObject({ headerRow: 3, mapping: { label: 6, committee: null, name: null, group: null }, committee: `id:${committees[2]!.id}`, skip: false });
    const p = plan([tracker()]);
    expect(p.good.map((g) => g.label)).toEqual(['Arab Republic of Egypt', 'Hashemite Kingdom of Jordan', 'Swiss Confederation', 'Kenya']);
    expect(p.good.every((g) => 'id' in g.committee && g.committee.id === committees[2]!.id)).toBe(true);
    expect(p.bad).toEqual([]);
    expect(p.blank).toBe(6);
    expect(p.good[0]!.line).toBe(5);
  });

  it('reads every tab of a workbook: the tab name or its title says the committee; tabs without a list are left out', () => {
    const sheets: Sheet[] = [
      { name: 'SC', rows: [['Country', 'Delegate'], ['Brazil', 'Ana'], ['China', 'Li']] },
      { name: 'Health', rows: [['Comité: WHO'], [], ['País', 'Nombre'], ['Chile', 'Sofía']] },
      { name: 'Read me', rows: [['How to fill this template'], ['Each tab is one committee: its name is in cell A1.']] },
      { name: 'Totals', rows: [['Sessions', 'Speeches'], ['4', '120']] },
    ];
    const layouts = sheets.map((s, i) => detectLayout(s, i, committees, false));
    expect(layouts.map((l) => [l.committee, l.skip])).toEqual([
      [`id:${committees[0]!.id}`, false],
      [`id:${committees[1]!.id}`, false],
      ['', true],
      ['', true],
    ]);
    const p = plan(sheets);
    // Brazil is already in the Security Council: counted, not an error.
    expect(p.existing).toBe(1);
    expect(p.good.map((g) => `${g.sheet}:${g.line}:${g.label}`)).toEqual(['SC:3:China', 'Health:4:Chile']);
    expect(p.bad).toEqual([]);
  });

  it('a tab without headings: the column of country names is the delegation', () => {
    const layout = detectLayout({ name: 'x', rows: [['1', 'France', 'Marie Curie'], ['2', 'Japan', 'Ken Watanabe'], ['3', 'Peru', 'Rosa Ríos'], ['4', 'Kenya', '']] }, 0, committees);
    expect(layout.mapping).toMatchObject({ label: 1, name: 2 });
  });

  it('a 500-row sheet with errors: good rows pass, each bad row says why', () => {
    const rows = [['Committee', 'Country', 'Name']];
    for (let i = 0; i < 500; i++) {
      if (i % 50 === 0) rows.push(['Nowhere', `Country ${i}`, '']); // unknown committee
      else if (i % 50 === 1) rows.push(['SC', '', 'No country']); // no label
      else if (i % 50 === 2) rows.push(['sc', 'brazil', '']); // already in the committee
      else rows.push([i % 2 ? 'SC' : 'World Health Organization', `Country ${i}`, `Student ${i}`]);
    }
    rows.push(['SC', 'Country 3', 'Again']); // twice in the sheet
    const p = plan([{ name: 'List', rows }]);
    expect(p.total).toBe(491);
    expect(p.existing).toBe(10);
    expect(p.bad.find((b) => b.line === 2)!.problems).toEqual(['committee_unknown']);
    expect(p.bad.find((b) => b.line === 3)!.problems).toEqual(['label_missing']);
    expect(p.bad.find((b) => b.line === 502)!.problems).toEqual(['duplicate']);
    expect(p.good.length + p.bad.length).toBe(491);
    expect(p.bad).toHaveLength(21);

    const report = errorReport(p.bad, (x) => x, { sheet: 'Tab', line: 'Line', problems: 'Problems' });
    const lines = parseCsv(report);
    expect(lines[0]).toEqual(['Tab', 'Line', '', '', '', 'Problems']);
    expect(lines[1]).toEqual(['List', '2', 'Nowhere', 'Country 0', '', 'committee_unknown']);
    expect(lines).toHaveLength(22);
  });

  it('creates committees only when asked, once per name', () => {
    const rows = [['Committee', 'Country'], ['HRC', 'Chile'], ['hrc', 'Peru'], ['Human Rights Council', 'Chile']];
    expect(plan([{ name: 'x', rows }]).good).toHaveLength(0);
    const p = plan([{ name: 'x', rows }], true);
    expect(p.newCommittees).toEqual(['HRC', 'Human Rights Council']);
    expect(p.good.map((g) => g.committee)).toEqual([
      { name: 'HRC', abbreviation: 'HRC', type_key: 'standard' },
      { name: 'hrc', abbreviation: '', type_key: 'standard' },
      { name: 'Human Rights Council', abbreviation: '', type_key: 'standard' },
    ]);
    // A tab whose title names a committee the conference does not have.
    const titled = plan([{ name: 'x', rows: [['Committee: UNEP'], ['Country'], ['Chile']] }], true);
    expect(titled.newCommittees).toEqual(['UNEP']);
  });

  it('a spreadsheet formula in a cell is not run when the report is opened', () => {
    const report = errorReport([{ sheet: 'x', line: 1, cells: ['=HYPERLINK("x")'], problems: ['label_missing'] }], (x) => x, { sheet: 'T', line: 'L', problems: 'P' });
    expect(report).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('reading Excel', () => {
  it('reads every visible tab, rows where the sheet has them, and refuses files over 2 MB', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Delegations');
    ws.getRow(1).values = ['Committee: SC'];
    ws.getRow(3).values = ['Country', 'Number'];
    ws.getRow(4).values = ['Brazil', 7];
    wb.addWorksheet('Other').addRow(['Chile']);
    wb.addWorksheet('Hidden', { state: 'hidden' }).addRow(['secret']);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const { readUpload } = await import('@/import/read');
    expect(await readUpload(new File([bytes], 'list.xlsx'))).toEqual({
      sheets: [
        { name: 'Delegations', rows: [['Committee: SC'], [], ['Country', 'Number'], ['Brazil', '7']] },
        { name: 'Other', rows: [['Chile']] },
      ],
      source: 'xlsx',
    });
    expect(await readUpload(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.csv'))).toEqual({ error: 'too_big' });
  });

  it('the template has a tab per committee that imports back as nothing new, and a read-me that is left out', async () => {
    const { templateXlsx } = await import('@/import/template');
    const bytes = await templateXlsx(
      [
        { name: 'Security Council', abbreviation: 'SC', labelHeading: 'Country', groups: [], delegations: [{ label: 'Brazil', name: '', group: '' }] },
        { name: 'World Health Organization', abbreviation: 'WHO', labelHeading: 'Country', groups: ['North', 'South'], delegations: [] },
      ],
      { name: "Student's name", group: 'Group', committee: 'Committee', readMe: 'Read me', instructions: ['How to fill this template', 'Each tab is one committee.'], example: 'X' },
      '#123456',
      '#ffffff',
    );
    const { readUpload } = await import('@/import/read');
    const read = await readUpload(new File([new Uint8Array(bytes)], 'template.xlsx'));
    if ('error' in read) throw new Error(read.error);
    expect(read.sheets.map((s) => s.name)).toEqual(['SC', 'WHO', 'Read me']);
    // Filled in: a row added to the WHO tab.
    read.sheets[1]!.rows.push(['Chile', 'Sofía']);
    const p = plan(read.sheets);
    expect(p.existing).toBe(1);
    expect(p.good.map((g) => [g.committeeName, g.label, g.name])).toEqual([['WHO', 'Chile', 'Sofía']]);
    expect(p.bad).toEqual([]);
  });
});
