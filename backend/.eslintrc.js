module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    // 'any' reste VISIBLE en avertissement (warn, ne fait pas échouer le CI) :
    // la codebase est lourdement typée dynamiquement (clauses `where` Prisma,
    // `$transaction`, Express `req`, libs tierces) — un passage systématique à
    // `unknown` + casts représenterait un refactor massif à risque. Les vrais
    // contrôles de robustesse sont portés par les guards, DTOs et tests.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      files: ['*.spec.ts', '*.e2e-spec.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
};
