import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/theme/contrast';
import { DEFAULT_THEME } from '@/theme/default-tokens';
import { renderEmail } from '@/theme/email';
import { buildTheme } from '@/theme/engine';
import { PRESET_KEYS } from '@/theme/presets';

const content = {
  schoolName: 'Colegio <b>Delta</b> & "Friends"',
  logoUrl: null,
  heading: 'You are invited',
  paragraphs: ['Press the button <script>alert(1)</script>'],
  button: { label: 'Accept invitation', url: 'https://delta.sessional.app/set-password?token_hash=abc&type=invite' },
  footer: 'Powered by sessional',
};

describe('renderEmail', () => {
  it('escapes everything the school or a person wrote', () => {
    const html = renderEmail(buildTheme(DEFAULT_THEME), content);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Delta</b>');
    expect(html).toContain('Colegio &lt;b&gt;Delta&lt;/b&gt; &amp; &quot;Friends&quot;');
    expect(html).toContain('token_hash=abc&amp;type=invite');
  });
  it('only links to web addresses', () => {
    const html = renderEmail(buildTheme(DEFAULT_THEME), { ...content, button: { label: 'x', url: 'javascript:alert(1)' }, logoUrl: 'data:image/png;base64,AAAA' });
    expect(html).not.toMatch(/javascript:|data:image/);
  });
  it('writes every colour as a value: no CSS variables, which email programs ignore', () => {
    for (const preset of PRESET_KEYS) {
      const html = renderEmail(buildTheme({ ...DEFAULT_THEME, preset }), content);
      expect(html, preset).not.toContain('var(');
      expect(html, preset).toMatch(/background:#[0-9A-F]{6}/);
    }
  });
  it('keeps the button and header readable for every preset', () => {
    for (const preset of PRESET_KEYS) {
      const html = renderEmail(buildTheme({ ...DEFAULT_THEME, preset, headerStyle: 'brand' }), content);
      const button = /background:(#[0-9A-F]{6});color:(#[0-9A-F]{6})/.exec(html)!;
      expect(contrastRatio(button[1]!, button[2]!), preset).toBeGreaterThanOrEqual(4.5);
      const header = /<td style="background:(#[0-9A-F]{6});color:(#[0-9A-F]{6})/.exec(html)!;
      expect(contrastRatio(header[1]!, header[2]!), preset).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('shows the logo when there is one', () => {
    const html = renderEmail(buildTheme(DEFAULT_THEME), { ...content, logoUrl: 'https://x.supabase.co/storage/v1/object/public/public-assets/a/logo.png' });
    expect(html).toContain('<img src="https://x.supabase.co/storage/v1/object/public/public-assets/a/logo.png"');
  });
});
