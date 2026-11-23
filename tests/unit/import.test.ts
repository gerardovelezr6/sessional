import { describe, expect, it, vi } from 'vitest';
import { detectMapping, errorReport, planImport, type CommitteeRef } from '@/import/plan';
import { parseCsv, sheetsCsvUrl } from '@/import/table';
import { standardStructure } from '@/structure/presets';

vi.mock('server-only', () => ({}));

describe('reading CSV', () => {
  it('handles quotes, doubled quotes, line breaks in cells, a byte-order mark and blank lines', () => {
    const text = '﻿Committee,Country,Name\r\nSC,"Korea, Republic of","Ana ""Ani"" Souza"\n\nWHO,"Côte\nd’Ivoire",\n';
    expect(parseCsv(text)).toEqual([
      ['Committee', 'Country', 'Name'],
      ['SC', 'Korea, Republic of', 'Ana "Ani" Souza'],
      ['WHO', 'Côte\nd’Ivoire', ''],
    ]);
  });
  it('detects semicolons and tabs', () => {
    expect(parseCsv('Comité;País\nCS;México')).toEqual([['Comité', 'País'], ['CS', 'México']]);
    expect(parseCsv('a\tb, c\n1\t2')).toEqual([['a', 'b, c'], ['1', '2']]);
  });
});

describe('Google Sheets links', () => {
  it('become the CSV download of the same sheet and tab, from Google only', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(sheetsCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`)).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=42`);
    expect(sheetsCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`)).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`);
    for (const bad of [`http://docs.google.com/spreadsheets/d/${id}`, `https://docs.google.com.evil.test/spreadsheets/d/${id}`, `https://evil.test/?u=https://docs.google.com/spreadsheets/d/${id}`, 'not a link', `https://docs.google.com/document/d/${id}`]) {
      expect(sheetsCsvUrl(bad), bad).toBeNull();
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
    expect(await readSheets(link, ok)).toEqual({ table: [['Committee', 'Country'], ['SC', 'Brazil']], source: 'sheets' });
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

describe('checking rows', () => {
  const structure = standardStructure();
  const committees: CommitteeRef[] = [
    { id: '00000000-0000-4000-8000-000000000001', name: 'Security Council', abbreviation: 'SC', type_key: 'standard', labels: ['Brazil'] },
    { id: '00000000-0000-4000-8000-000000000002', name: 'World Health Organization', abbreviation: 'WHO', type_key: 'standard', labels: [] },
  ];

  it('recognises headings in either language, and falls back to column order', () => {
    expect(detectMapping([['Nombre del delegado', 'Comité', 'País']])).toEqual({ mapping: { committee: 1, label: 2, name: 0, group: null }, header: true });
    expect(detectMapping([['SC', 'Brazil', 'Ana']])).toEqual({ mapping: { committee: 0, label: 1, name: 2, group: null }, header: false });
  });

  it('a 500-row sheet with errors: good rows pass, each bad row says why', () => {
    const table = [['Committee', 'Country', 'Name']];
    for (let i = 0; i < 500; i++) {
      if (i % 50 === 0) table.push(['Nowhere', `Country ${i}`, '']); // unknown committee
      else if (i % 50 === 1) table.push(['SC', '', 'No country']); // no label
      else if (i % 50 === 2) table.push(['sc', 'brazil', '']); // already in the committee
      else table.push([i % 2 ? 'SC' : 'World Health Organization', `Country ${i}`, `Student ${i}`]);
    }
    table.push(['WHO', 'Country 3', 'Again']); // duplicate within the sheet (row 3 went to SC, row 4 to WHO… row 3 is odd → SC)
    table.push(['WHO', 'Country 4', 'Again']); // duplicate of row 4 in WHO
    const plan = planImport({ table, ...detectMapping(table), committees, structure, createCommittees: false, defaultCommittee: null });
    expect(plan.total).toBe(502);
    expect(plan.good).toHaveLength(470 + 1);
    expect(plan.bad).toHaveLength(31);
    expect(plan.bad.find((b) => b.line === 2)!.problems).toEqual(['committee_unknown']);
    expect(plan.bad.find((b) => b.line === 3)!.problems).toEqual(['label_missing']);
    expect(plan.bad.find((b) => b.line === 4)!.problems).toEqual(['duplicate']);
    expect(plan.bad.at(-1)).toMatchObject({ line: 503, problems: ['duplicate'] });
    expect(plan.good[0]).toMatchObject({ line: 5, committee: { id: committees[0]!.id }, label: 'Country 3', name: 'Student 3' });

    const report = errorReport(table[0]!, plan.bad, (p) => p, { line: 'Line', problems: 'Problems' });
    const lines = parseCsv(report);
    expect(lines[0]).toEqual(['Line', 'Committee', 'Country', 'Name', 'Problems']);
    expect(lines[1]).toEqual(['2', 'Nowhere', 'Country 0', '', 'committee_unknown']);
    expect(lines).toHaveLength(32);
  });

  it('creates committees only when asked, once per name, and uses a default committee when there is no column', () => {
    const table = [['Committee', 'Country'], ['HRC', 'Chile'], ['hrc', 'Peru'], ['Human Rights Council', 'Chile']];
    expect(planImport({ table, ...detectMapping(table), committees, structure, createCommittees: false, defaultCommittee: null }).good).toHaveLength(0);
    const plan = planImport({ table, ...detectMapping(table), committees, structure, createCommittees: true, defaultCommittee: null });
    expect(plan.newCommittees).toEqual(['HRC', 'Human Rights Council']);
    expect(plan.good.map((g) => g.committee)).toEqual([
      { name: 'HRC', abbreviation: 'HRC', type_key: 'standard' },
      { name: 'hrc', abbreviation: '', type_key: 'standard' },
      { name: 'Human Rights Council', abbreviation: '', type_key: 'standard' },
    ]);
    const only = [['Country'], ['Chile']];
    expect(planImport({ table: only, ...detectMapping(only), committees, structure, createCommittees: false, defaultCommittee: committees[1]!.id }).good[0]!.committee).toEqual({ id: committees[1]!.id });
  });

  it('a spreadsheet formula in a cell is not run when the report is opened', () => {
    const report = errorReport(null, [{ line: 1, cells: ['=HYPERLINK("x")'], problems: ['label_missing'] }], (p) => p, { line: 'L', problems: 'P' });
    expect(report).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('reading Excel', () => {
  it('reads the first sheet as text, and refuses files over 2 MB', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Delegations');
    ws.addRow(['Committee', 'Country', 'Number']);
    ws.addRow(['SC', 'Brazil', 7]);
    wb.addWorksheet('Other').addRow(['ignored']);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const { readUpload } = await import('@/import/read');
    expect(await readUpload(new File([bytes], 'list.xlsx'))).toEqual({ table: [['Committee', 'Country', 'Number'], ['SC', 'Brazil', '7']], source: 'xlsx' });
    expect(await readUpload(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.csv'))).toEqual({ error: 'too_big' });
  });
});
