import { Fragment, type ReactNode } from 'react';

// A small Markdown reader for the help center's own articles, line by line: "## " and "### "
// headings, paragraphs (blank lines between), "- " and "1. " lists, **bold** and [links](/path).
// Content is ours, never a school's.

type Block = { kind: 'h2' | 'h3' | 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const last = blocks.at(-1);
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      flush();
      blocks.push({ kind: line.startsWith('### ') ? 'h3' : 'h2', text: line.replace(/^#{2,3} /, '') });
    } else if (/^- /.test(line)) {
      flush();
      if (last?.kind === 'ul' && !para.length) last.items.push(line.slice(2));
      else blocks.push({ kind: 'ul', items: [line.slice(2)] });
    } else if (/^\d+\. /.test(line)) {
      flush();
      if (last?.kind === 'ol') last.items.push(line.replace(/^\d+\. /, ''));
      else blocks.push({ kind: 'ol', items: [line.replace(/^\d+\. /, '')] });
    } else if ((last?.kind === 'ul' || last?.kind === 'ol') && !para.length && /^\s{2,}/.test(raw)) {
      // A list item's continuation line.
      last.items[last.items.length - 1] += ` ${line}`;
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

export const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} className="font-semibold text-on-surface">{m[1]}</strong>);
    else if (m[4]) out.push(<code key={m.index} className="rounded-control bg-surface-raised px-1 font-mono text-[0.9em] text-on-surface">{m[4]}</code>);
    else
      out.push(
        <a key={m.index} href={m[3]} className="font-semibold text-on-surface underline underline-offset-2">
          {m[2]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseMarkdown(source).map((b, i) => {
        if (b.kind === 'h2')
          return (
            <h2 key={i} id={slugOf(b.text)} className="mt-8 scroll-mt-24 border-t border-border pt-6 text-xl font-semibold text-on-surface first:mt-0 first:border-t-0 first:pt-0">
              {b.text}
            </h2>
          );
        if (b.kind === 'h3')
          return (
            <h3 key={i} className="mt-4 font-semibold text-on-surface">
              {b.text}
            </h3>
          );
        if (b.kind === 'ul')
          return (
            <ul key={i} className="flex list-disc flex-col gap-2 ps-5 marker:text-on-surface-muted">
              {b.items.map((x, j) => (
                <li key={j}>{inline(x)}</li>
              ))}
            </ul>
          );
        if (b.kind === 'ol')
          return (
            <ol key={i} className="flex list-decimal flex-col gap-2 ps-5 marker:font-semibold marker:text-on-surface">
              {b.items.map((x, j) => (
                <li key={j} className="ps-1">
                  {inline(x)}
                </li>
              ))}
            </ol>
          );
        return b.kind === 'p' ? (
          <p key={i}>
            <Fragment>{inline(b.text)}</Fragment>
          </p>
        ) : null;
      })}
    </>
  );
}
