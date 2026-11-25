import { Fragment, type ReactNode } from 'react';

// A small Markdown reader for the help center's own articles: "## " and "### " headings,
// paragraphs, "- " and "1. " lists, **bold** and [links](/path). Content is ours, never a school's.

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} className="font-semibold text-on-surface">{m[1]}</strong>);
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

export function Markdown({ source, idPrefix = '' }: { source: string; idPrefix?: string }) {
  const blocks = source.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const slug = (s: string) => idPrefix + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (
    <>
      {blocks.map((b, i) => {
        if (b.startsWith('## '))
          return (
            <h2 key={i} id={slug(b.slice(3))} className="mt-6 scroll-mt-20 text-xl font-semibold text-on-surface">
              {b.slice(3)}
            </h2>
          );
        if (b.startsWith('### '))
          return (
            <h3 key={i} className="mt-4 font-semibold text-on-surface">
              {b.slice(4)}
            </h3>
          );
        const lines = b.split('\n');
        if (lines.every((l) => /^- /.test(l)))
          return (
            <ul key={i} className="list-disc ps-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        if (lines.every((l) => /^\d+\. /.test(l)))
          return (
            <ol key={i} className="list-decimal ps-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>
              ))}
            </ol>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j ? ' ' : null}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
