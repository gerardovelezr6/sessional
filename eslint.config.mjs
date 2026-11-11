import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import sessional from './eslint-rules/index.mjs';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**'] },
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/**/*.{ts,tsx}'],
    // src/theme defines the tokens, so it is the one place raw values may appear.
    ignores: ['src/theme/**'],
    plugins: { sessional },
    rules: {
      'sessional/no-raw-design-values': 'error',
      'sessional/no-physical-direction': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { sessional },
    rules: { 'sessional/no-literal-ui-text': 'error' },
  },
];

export default config;
