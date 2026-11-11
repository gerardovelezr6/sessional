// Fails when server-only secrets could reach the browser:
//   1. a NEXT_PUBLIC_ variable whose name suggests a secret,
//   2. a client component that reads a non-public environment variable.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_WORD = /SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|WEBHOOK|(?<!ANON_)KEY/;
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) inspect(p);
  }
}

function inspect(file) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    if (SECRET_WORD.test(m[0].replace('NEXT_PUBLIC_', ''))) problems.push(`${file}: ${m[0]} looks like a secret exposed to the browser`);
  }
  if (/^\s*['"]use client['"]/m.test(src)) {
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!m[1].startsWith('NEXT_PUBLIC_') && m[1] !== 'NODE_ENV') problems.push(`${file}: client component reads server variable ${m[1]}`);
    }
  }
}

walk('src');
for (const m of readFileSync('.env.example', 'utf8').matchAll(/^(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)) {
  if (SECRET_WORD.test(m[1].replace('NEXT_PUBLIC_', ''))) problems.push(`.env.example: ${m[1]} looks like a secret exposed to the browser`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('No server secret is reachable from client code.');
