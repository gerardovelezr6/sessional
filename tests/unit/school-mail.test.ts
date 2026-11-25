import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { defaultConfig } from '@/config/schema';
import { composeEmail } from '@/platform/school-mail';

// The emails a school sends: its words where it wrote them, Sessional's otherwise, with the
// placeholders filled in and nothing a school types able to break the subject line.
const vars = { name: 'Ana', school: 'Colegio Norte', role: 'Chair', link: 'https://norte.example/set-password?x=1' };

describe('school email', () => {
  it('uses Sessional’s words by default, in the reader’s language', () => {
    const en = composeEmail(defaultConfig(), 'invite', 'en', vars, null);
    expect(en.subject).toBe('You’re invited to Colegio Norte');
    expect(en.text).toContain('Hi Ana,');
    expect(en.text).toContain(`Accept the invitation: ${vars.link}`);
    expect(en.html).toContain(vars.link.replace('&', '&amp;'));
    const es = composeEmail(defaultConfig(), 'reset', 'es', vars, null);
    expect(es.subject).toBe('Elige una contraseña nueva para Colegio Norte');
    expect(es.text).toContain('Enviado por Colegio Norte a través de Sessional.');
  });
  it('uses the school’s own words and footer, filling the placeholders', () => {
    const config = defaultConfig();
    config.email.addedSubject = { en: 'Welcome aboard, {name}\r\nBcc: x@y.z' };
    config.email.addedBody = { en: 'Dear {name},\n\nYou joined {school} as {role}.' };
    config.email.footer = { en: '123 Main St.' };
    const mail = composeEmail(config, 'added', 'en', vars, null);
    expect(mail.subject).toBe('Welcome aboard, Ana Bcc: x@y.z');
    expect(mail.text).toContain('You joined Colegio Norte as Chair.');
    expect(mail.text).toContain('123 Main St.');
    // Spanish readers still get Sessional's Spanish where the school wrote only English.
    expect(composeEmail(config, 'added', 'es', vars, null).subject).toBe('Te agregaron a Colegio Norte');
  });
});
