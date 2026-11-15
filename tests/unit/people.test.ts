import { describe, expect, it } from 'vitest';
import { passwordProblems, type PasswordPolicy } from '@/people/password';
import { effectivePermissions, PERMISSIONS } from '@/people/permissions';
import { messageFor, type MessageKey } from '@/messages';
import { starterRoles } from '@/presets/roles';

const policy = (over: Partial<PasswordPolicy> = {}): PasswordPolicy => ({ passwordMinLength: 8, passwordRequire: 'length', passwordBlockCommon: 'on', ...over });

describe('password rules', () => {
  it('checks the length in characters, not bytes', () => {
    expect(passwordProblems('ñandú-río', policy({ passwordMinLength: 9 }))).toEqual([]);
    expect(passwordProblems('short1', policy())).toEqual(['short']);
  });
  it('asks for letters and numbers, or for every kind of character', () => {
    expect(passwordProblems('onlyletterslong', policy({ passwordRequire: 'letters_numbers' }))).toEqual(['letters_numbers']);
    expect(passwordProblems('letters4ndnumbers', policy({ passwordRequire: 'letters_numbers' }))).toEqual([]);
    expect(passwordProblems('lower4ndnumbers', policy({ passwordRequire: 'mixed' }))).toEqual(['mixed']);
    expect(passwordProblems('Upper-l0wer!', policy({ passwordRequire: 'mixed' }))).toEqual([]);
  });
  it('refuses common passwords in their usual disguises, and personal ones', () => {
    for (const p of ['password', 'Password1!', 'P@ssw0rd', 'qwerty123', 'aaaaaaaaaa', 'Contraseña1']) expect(passwordProblems(p, policy()), p).toContain('common');
    expect(passwordProblems('maria.lopez2027', policy(), { email: 'maria.lopez@school.test' })).toContain('personal');
    expect(passwordProblems('greenvalleymun!', policy(), { school: 'Green Valley MUN' })).toContain('personal');
    expect(passwordProblems('Password1!', policy({ passwordBlockCommon: 'off' }))).toEqual([]);
  });
});

describe('permissions', () => {
  it('every permission has a name and an explanation in English and Spanish', () => {
    for (const p of PERMISSIONS) {
      for (const locale of ['en', 'es']) {
        expect(messageFor(`permission.${p.key}` as MessageKey, locale).text).not.toBe(`permission.${p.key}`);
        expect(messageFor(`permission.${p.key}.help` as MessageKey, locale).text).not.toBe(`permission.${p.key}.help`);
      }
    }
  });
  it('includes only what the database also grants', () => {
    expect([...effectivePermissions(['users.manage'])].sort()).toEqual(['users.manage', 'users.view']);
    expect([...effectivePermissions(['committee.manage'])].sort()).toEqual(['committee.manage', 'crisis.view', 'delegates.manage']);
    expect([...effectivePermissions(['grades.manage'])]).toEqual(['grades.manage']);
  });
});

describe('starter roles', () => {
  it('High Command (usually students) runs the conference without staff permissions; Advisors have them', () => {
    const roles = starterRoles({ pack: 'un', overrides: {} }, ['en']);
    const staff = PERMISSIONS.filter((p) => p.staff).map((p) => p.key);
    const hc = roles.find((r) => r.key === 'high_command')!;
    expect(staff.filter((p) => hc.permissions.includes(p))).toEqual([]);
    expect(hc.permissions).toEqual(expect.arrayContaining(['committee.manage', 'users.manage', 'grades.view', 'announcements.manage']));
    expect(roles.find((r) => r.key === 'advisor')!.permissions).toEqual(expect.arrayContaining(PERMISSIONS.map((p) => p.key)));
  });
});
