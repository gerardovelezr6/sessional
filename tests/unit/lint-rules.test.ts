import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import sessional from '../../eslint-rules/index.mjs';

function lint(code: string, rule: string): string[] {
  const messages = new Linter().verify(code, [
    {
      files: ['**/*.tsx'],
      plugins: { sessional },
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: { [`sessional/${rule}`]: 'error' },
    },
  ], 'component.tsx');
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(fatal.message);
  return messages.map((m) => m.message);
}

describe('no-raw-design-values', () => {
  const bad = [
    `const c = '#14213D';`,
    `const c = '#fff';`,
    'const c = `color: #F2A541`;',
    `const c = 'rgb(20 33 61)';`,
    `const c = 'oklch(0.5 0.1 250)';`,
    `const x = <p className="text-emerald-400" />;`,
    `const x = <p className="bg-white p-2" />;`,
    `const x = <p className="hover:border-red-600" />;`,
    `const x = <p className="rounded-[3px]" />;`,
    `const x = <p className="bg-[#123456]" />;`,
  ];
  const good = [
    `const x = <p className="bg-surface text-on-surface rounded-control" />;`,
    `const x = <a href="#main" />;`,
    `const x = <a href="/committees#speakers" />;`,
    `const x = <p className="text-accent border-border" />;`,
    `const id = 'issue #12';`,
  ];
  it.each(bad)('rejects %s', (code) => expect(lint(code, 'no-raw-design-values')).toHaveLength(1));
  it.each(good)('accepts %s', (code) => expect(lint(code, 'no-raw-design-values')).toEqual([]));
});

describe('no-physical-direction', () => {
  const bad = [
    `const x = <p className="ml-2" />;`,
    `const x = <p className="md:pr-4" />;`,
    `const x = <p className="text-left" />;`,
    `const x = <p className="left-0 absolute" />;`,
    `const x = <p className="border-l-2" />;`,
    `const x = <p className="-mr-1" />;`,
  ];
  const good = [
    `const x = <p className="ms-2 pe-4 text-start start-0 border-s-2" />;`,
    `const x = <p className="mt-2 pb-4 mx-auto px-3" />;`,
  ];
  it.each(bad)('rejects %s', (code) => expect(lint(code, 'no-physical-direction')).toHaveLength(1));
  it.each(good)('accepts %s', (code) => expect(lint(code, 'no-physical-direction')).toEqual([]));
});

describe('no-literal-ui-text', () => {
  const bad = [
    `const x = <p>Saved</p>;`,
    `const x = <p>{'Saved'}</p>;`,
    'const x = <p>{`Guardado ${n}`}</p>;',
    `const x = <img alt="Logo" />;`,
    `const x = <input placeholder="Country" />;`,
    `const x = <button aria-label={'Close'} />;`,
    `const x = <p>Ñandú</p>;`,
  ];
  const good = [
    `const x = <p>{t('saved')}</p>;`,
    `const x = <img alt={t('logo')} />;`,
    `const x = <p className="flex">{count} / {total}</p>;`,
    `const x = <p> · </p>;`,
    `const x = <input type="text" name="country" />;`,
  ];
  it.each(bad)('rejects %s', (code) => expect(lint(code, 'no-literal-ui-text')).toHaveLength(1));
  it.each(good)('accepts %s', (code) => expect(lint(code, 'no-literal-ui-text')).toEqual([]));
});
