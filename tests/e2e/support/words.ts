import { readFileSync } from 'node:fs';

// The product's own Spanish for a piece of English UI text, from the message catalogs, so a test can
// run a school in Spanish without copying translations. Give the English as written in en.json
// (with {placeholders}); throws if it isn't there or means two different things in Spanish.
const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8')) as Record<string, string>;
const es = JSON.parse(readFileSync('src/messages/es.json', 'utf8')) as Record<string, string>;

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export function spanish(english: string, vars: Record<string, string | number> = {}): string {
  const found = [...new Set(Object.keys(en).filter((k) => en[k] === english).map((k) => es[k]!))];
  if (found.length === 0) throw new Error(`No message reads “${english}”`);
  if (found.length > 1) throw new Error(`“${english}” has ${found.length} Spanish versions: ${found.join(' | ')}`);
  return fill(found[0]!, vars);
}

// The Spanish of one message, by key.
export function key(name: string, vars: Record<string, string | number> = {}): string {
  const text = es[name];
  if (text === undefined) throw new Error(`No message ${name}`);
  return fill(text, vars);
}

// The `=0` branch of a plural message ("{count, plural, =0 {…} …}").
export const zeroOf = (name: string) => /=0 \{([^}]*)\}/.exec(key(name))![1]!;

// A pattern matching the Spanish of a message whatever fills its placeholders.
export function keyPattern(name: string): RegExp {
  const parts = key(name).split(/\{\w+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.+')}$`);
}
