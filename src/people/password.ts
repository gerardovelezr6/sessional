// The school's password rules, checked on the server when a password is chosen.

export interface PasswordPolicy {
  passwordMinLength: number;
  passwordRequire: 'length' | 'letters_numbers' | 'mixed';
  passwordBlockCommon: 'on' | 'off';
}

export type PasswordProblem = 'short' | 'letters_numbers' | 'mixed' | 'common' | 'personal';

// The most used passwords, and the shapes they come in. A short list on purpose: the length rule
// does the heavy lifting; this stops the obvious ones.
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789', '1234567890', '123123123', '11111111', '00000000',
  'qwerty123', 'qwertyuiop', '1q2w3e4r', '1q2w3e4r5t', 'abc12345', 'abcd1234', 'iloveyou', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'welcome1', 'welcome123', 'letmein1', 'trustno1', 'dragon123', 'monkey123', 'master123', 'starwars',
  'whatever', 'computer', 'internet', 'contraseña', 'contrasena', 'contrasena1', 'admin123', 'administrator', 'changeme', 'secret123',
  'modelun', 'modelun1', 'mun12345', 'delegate', 'delegate1', 'unitednations', 'school123', 'student1', 'teacher1', 'summer2026',
]);

const squash = (s: string) => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function passwordProblems(password: string, policy: PasswordPolicy, context: { email?: string; school?: string } = {}): PasswordProblem[] {
  const out: PasswordProblem[] = [];
  if ([...password].length < policy.passwordMinLength) out.push('short');
  const letter = /\p{L}/u.test(password);
  const digit = /\p{N}/u.test(password);
  if (policy.passwordRequire === 'letters_numbers' && !(letter && digit)) out.push('letters_numbers');
  if (policy.passwordRequire === 'mixed' && !(/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password) && digit && /[^\p{L}\p{N}\s]/u.test(password))) out.push('mixed');
  if (policy.passwordBlockCommon === 'on') {
    const flat = squash(password);
    // "P@ssw0rd" is "password" with symbols for letters.
    const plain = squash(password.toLowerCase().replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/0/g, 'o').replace(/3/g, 'e').replace(/7/g, 't').replace(/!/g, 'i'));
    // "Password1!" is still "password1"; so are runs of one character.
    const common = (w: string) => COMMON.has(w) || COMMON.has(w.replace(/\d+$/, ''));
    if (common(flat) || common(plain) || /^(.)\1+$/.test(flat)) out.push('common');
    const local = squash(context.email?.split('@')[0] ?? '');
    const school = squash(context.school ?? '');
    if ((local.length >= 4 && flat.includes(local)) || (school.length >= 4 && flat.includes(school))) out.push('personal');
  }
  return out;
}
