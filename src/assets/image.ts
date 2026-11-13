// Recognises an uploaded image from its bytes, never from its name or the type the browser
// claims, and reads its size. Only PNG, JPEG and WebP are accepted: no SVG (it can carry script).

export type ImageType = 'png' | 'jpeg' | 'webp';
export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

export const CONTENT_TYPE: Record<ImageType, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
export const EXTENSION: Record<ImageType, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

function png(b: Uint8Array): ImageInfo | null {
  if (b.length < 24 || !startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (!startsWith(b, [0x49, 0x48, 0x44, 0x52], 12)) return null; // IHDR
  return { type: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || !startsWith(b, [0xff, 0xd8, 0xff])) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before a size
    const length = u16be(b, i + 2);
    // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { type: 'jpeg', width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30 || !startsWith(b, [0x52, 0x49, 0x46, 0x46]) || !startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return null;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === 'VP8X') return { type: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === 'VP8 ') return { type: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}

// What each kind of school image must be.
export const ASSET_RULES = {
  logo: { types: ['png', 'jpeg', 'webp'] as ImageType[], maxBytes: 2 * 1024 * 1024, minSide: 16, maxSide: 4096, square: false },
  favicon: { types: ['png'] as ImageType[], maxBytes: 512 * 1024, minSide: 32, maxSide: 1024, square: true },
  // Logos of groups such as parties, shown in place of a flag.
  group: { types: ['png', 'jpeg', 'webp'] as ImageType[], maxBytes: 512 * 1024, minSide: 16, maxSide: 1024, square: false },
} as const;
export type AssetKind = keyof typeof ASSET_RULES;

export type AssetProblem = 'type' | 'size' | 'dimensions' | 'square';

export function checkAsset(kind: AssetKind, bytes: Uint8Array): { ok: true; info: ImageInfo } | { ok: false; problem: AssetProblem } {
  const rule = ASSET_RULES[kind];
  if (bytes.length > rule.maxBytes) return { ok: false, problem: 'size' };
  const info = inspectImage(bytes);
  if (!info || !rule.types.includes(info.type)) return { ok: false, problem: 'type' };
  const sides = [info.width, info.height];
  if (sides.some((s) => s < rule.minSide || s > rule.maxSide)) return { ok: false, problem: 'dimensions' };
  if (rule.square && info.width !== info.height) return { ok: false, problem: 'square' };
  return { ok: true, info };
}

// Where a school's file is stored: under its own tenant id, named by its content so a new upload
// never collides with a cached old one.
export const ASSET_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(logo|favicon|group)-[0-9a-f]{16}\.(png|jpg|webp)$/;

export function assetPath(tenantId: string, kind: AssetKind, digestHex: string, type: ImageType): string {
  return `${tenantId}/${kind}-${digestHex.slice(0, 16)}.${EXTENSION[type]}`;
}

// A stored path is only used for the tenant it belongs to.
export function belongsTo(path: string | null | undefined, tenantId: string): path is string {
  const m = path ? ASSET_PATH.exec(path) : null;
  return !!m && m[1] === tenantId;
}
