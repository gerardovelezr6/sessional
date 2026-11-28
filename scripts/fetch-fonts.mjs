#!/usr/bin/env node
// Downloads the Sessional website's Fontshare fonts (Zodiak, Switzer, Satoshi) into public/fonts/fontshare,
// where the site serves them from its own domain. Runs before every build and dev server.
//
// Why they are not in the repository: they are licensed under the ITF Free Font License
// (fontshare.com), which allows self-hosting them for our own website but not sharing the files
// through a publicly accessible repository, and this repository is public. So each build fetches
// the official, unmodified files from Fontshare instead. If Fontshare cannot be reached, the build
// carries on and the site falls back to the next fonts in its stacks.
//
// Use: they are for the Sessional website only. The license does not allow offering them to
// schools as a font choice, so they must never be added to the theme's font list.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'fonts', 'fontshare');
const API = process.env.FONTSHARE_API_URL || 'https://api.fontshare.com/v2/css';

// family slug, family name as Fontshare names it, the weights and styles the site uses.
const FONTS = [
  { slug: 'zodiak', family: 'Zodiak', want: ['400', '700'] },
  { slug: 'switzer', family: 'Switzer', want: ['400', '500', '600', '700', '400i'] },
  // The wordmark's typeface: figures (clocks, tallies, codes) and short spec lines.
  { slug: 'satoshi', family: 'Satoshi', want: ['500', '700'] },
];

const isWoff2 = (buf) => buf.length > 1000 && buf.subarray(0, 4).toString('latin1') === 'wOF2';

async function have(file) {
  try {
    return (await stat(file)).size > 1000 && isWoff2(await readFile(file));
  } catch {
    return false;
  }
}

async function get(url, as) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

async function fetchFamily({ slug, family, want }) {
  let saved = 0;
  for (const w of want) {
    const italic = w.endsWith('i');
    const weight = italic ? w.slice(0, -1) : w;
    const file = join(OUT, `${slug}-${weight}${italic ? '-italic' : ''}.woff2`);
    if (await have(file)) continue;
    // One face per request: Fontshare's CSS lists its @font-face rules; take the one asked for.
    const css = await get(`${API}?${new URLSearchParams({ 'f[]': `${slug}@${w}`, display: 'swap' })}`, 'text');
    const face = css
      .split('@font-face')
      .find((f) => f.includes(`'${family}'`) && f.includes(`font-weight: ${weight};`) && f.includes(`font-style: ${italic ? 'italic' : 'normal'};`));
    const src = face?.match(/url\('([^']+\.woff2)'\)/)?.[1];
    if (!src) throw new Error(`no ${family} ${w} in Fontshare's answer`);
    const font = await get(src.startsWith('//') ? `https:${src}` : src);
    if (!isWoff2(font)) throw new Error(`${family} ${w} is not a WOFF2 file`);
    await writeFile(file, font);
    saved++;
  }
  return saved;
}

await mkdir(OUT, { recursive: true });
for (const f of FONTS) {
  try {
    const saved = await fetchFamily(f);
    console.log(`fonts: ${f.family} ${saved ? `downloaded ${saved} file(s)` : 'up to date'}`);
  } catch (e) {
    console.warn(`fonts: could not get ${f.family} from Fontshare (${e instanceof Error ? e.message : e}); the site will use its fallback fonts.`);
  }
}
