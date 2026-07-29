// Extends the shared root flat config (no-console = error, no explicit any)
// and adds the browser/JSX bits it doesn't know about.
import rootConfig from '../../eslint.config.mjs';

export default [
  { ignores: ['.next/**', 'next-env.d.ts', 'screenshots/**'] },
  ...rootConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
];
