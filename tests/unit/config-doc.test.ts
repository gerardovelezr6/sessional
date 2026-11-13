import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderConfigDoc } from '@/config/doc';
import { registry } from '@/config/registry';

const PATH = 'docs/CONFIG.md';

describe('docs/CONFIG.md', () => {
  it('lists every setting', () => {
    const doc = renderConfigDoc();
    for (const r of registry) expect(doc, `${r.section}.${r.key}`).toContain(`\`${r.section}.${r.key}\``);
  });

  it('is up to date (run `npm run config:doc` to regenerate)', () => {
    const doc = renderConfigDoc();
    if (process.env.WRITE_CONFIG_DOC === '1') writeFileSync(PATH, doc);
    expect(existsSync(PATH) ? readFileSync(PATH, 'utf8') : '').toBe(doc);
  });
});
