import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FlagChoice } from '@/structure/flags';

// Flags for printables. PDF cannot hold SVG, so the same flag files the app shows (flag-icons for
// countries, the bundled US state flags) are turned into PNG images on the server, once per flag
// per process. A group's uploaded logo is fetched as is (PNG or JPEG). Nothing found: no flag.

const cache = new Map<string, Promise<Uint8Array | null>>();

async function svgToPng(file: string): Promise<Uint8Array | null> {
  try {
    const svg = await readFile(file);
    const sharp = (await import('sharp')).default;
    // 4:3, wide enough to print sharp at placard size.
    return new Uint8Array(await sharp(svg, { density: 300 }).resize(480, 360, { fit: 'fill' }).png().toBuffer());
  } catch {
    return null;
  }
}

export function flagPng(choice: FlagChoice, logoUrl: string | null = null): Promise<Uint8Array | null> {
  if (!choice) return Promise.resolve(null);
  let key: string;
  let load: () => Promise<Uint8Array | null>;
  if (choice.kind === 'country' && /^[a-z]{2}$/.test(choice.code)) {
    key = `c:${choice.code}`;
    load = () => svgToPng(path.join(process.cwd(), 'node_modules', 'flag-icons', 'flags', '4x3', `${choice.code}.svg`));
  } else if (choice.kind === 'us' && /^[a-z]{2}$/.test(choice.code)) {
    key = `u:${choice.code}`;
    load = () => svgToPng(path.join(process.cwd(), 'public', 'flags', 'us', `${choice.code}.svg`));
  } else if (choice.kind === 'logo' && logoUrl) {
    key = `l:${logoUrl}`;
    load = async () => {
      try {
        const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
        const b = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        return b && b.byteLength <= 2 * 1024 * 1024 ? b : null;
      } catch {
        return null;
      }
    };
  } else return Promise.resolve(null);
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
  }
  return hit;
}
