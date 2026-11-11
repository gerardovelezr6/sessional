// supabase/schema.sql mirrors the migrations: every migration, in order, in one re-runnable file.
// `npm run schema:build` regenerates it; `npm run schema:check` fails when it has drifted.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const out = 'supabase/schema.sql';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const bad = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
if (bad.length) {
  console.error(`Migration names must be <14-digit timestamp>_<snake_case>.sql: ${bad.join(', ')}`);
  process.exit(1);
}

const header =
  '-- Sessional database schema. GENERATED from supabase/migrations by scripts/build-schema.mjs.\n' +
  '-- Do not edit by hand. Safe to run on a fresh database and safe to re-run.\n';
const body = files.map((f) => `\n-- ── ${f} ──\n${readFileSync(join(dir, f), 'utf8').trimEnd()}\n`).join('');
const next = header + body;

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== next) {
    console.error(`${out} is out of date. Run: npm run schema:build`);
    process.exit(1);
  }
  console.log(`${out} matches ${files.length} migration(s).`);
} else {
  writeFileSync(out, next);
  console.log(`Wrote ${out} from ${files.length} migration(s).`);
}
