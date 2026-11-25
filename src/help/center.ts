import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The customer help center on the main website (/help): articles written as Markdown in
// content/help/<language>/<slug>.md, the same files the repository shows. Each starts with
// "# Title" and a "> summary" line.

export const HELP_GROUPS = [
  { key: 'start', slugs: ['getting-started', 'team', 'customizing'] },
  { key: 'conference', slugs: ['running-a-session', 'projection', 'grading', 'public-pages'] },
  { key: 'guides', slugs: ['high-command-guide', 'advisor-guide'] },
  { key: 'account', slugs: ['domains-email', 'billing', 'data-privacy', 'accessibility'] },
] as const;
export const HELP_SLUGS: readonly string[] = HELP_GROUPS.flatMap((g) => g.slugs);

export interface Article {
  slug: string;
  title: string;
  summary: string;
  body: string;
}

export async function readArticle(slug: string, locale: 'en' | 'es'): Promise<Article | null> {
  if (!HELP_SLUGS.includes(slug)) return null;
  const text = await readFile(join(process.cwd(), 'content', 'help', locale, `${slug}.md`), 'utf8').catch(() => null);
  if (!text) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const title = lines[0]!.replace(/^# /, '').trim();
  const summaryAt = lines.findIndex((l) => l.startsWith('> '));
  const summary = summaryAt >= 0 ? lines[summaryAt]!.slice(2).trim() : '';
  const body = lines.slice(summaryAt >= 0 ? summaryAt + 1 : 1).join('\n').trim();
  return { slug, title, summary, body };
}
