module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: [
    'dist',
    'coverage',
    'android',
    'public',
    '.eslintrc.cjs',
    'vite.config.ts',
    'vite.mock.config.ts',
    'vite.mock-plugin.ts',
    'scripts',
    '*.config.ts',
  ],
  rules: {
    // Règles React Hooks : jamais silencieuses jusqu'ici (plugin chargé mais
    // aucune règle activée). `rules-of-hooks` = erreur (bug garanti sinon),
    // `exhaustive-deps` = warn (utile mais parfois volontairement partiel).
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Aligné sur le backend : `any` visible mais non-bloquant (libs carto/charts
    // et payloads socket peu typés), `_prefix` pour les args volontairement ignorés.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // tsc (`strict` + `noUnusedLocals`) porte déjà ces contrôles ; on évite les
    // doublons de diagnostics tout en gardant les règles utiles ci-dessus.
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    // `while (true) { ... }` avec `break` interne = idiome légitime des files
    // d'attente / boucles de drain ; on ne bloque que les conditions constantes
    // hors boucle (vrai bug).
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**', 'src/test-setup.ts'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
};
