module.exports = {
  root: true,
  extends: ['@stacks/eslint-config', 'prettier'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'eslint-plugin-tsdoc', 'prettier'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  ignorePatterns: ['lib/*', 'client/*', 'utils/*'],
  rules: {
    'prettier/prettier': 'error',

    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-use-before-define': ['error', 'nofunc'],
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    'no-warning-comments': 'warn',
    'tsdoc/syntax': 'error',
    // TODO: fix these
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/restrict-plus-operands': 'off',

    // TODO: temporarily disable this until the express async handler is typed correctly
    '@typescript-eslint/no-misused-promises': 'off',
  },
};
