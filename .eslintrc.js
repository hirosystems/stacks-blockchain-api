module.exports = {
  root: true,
  extends: ['@blockstack/eslint-config'],
  parser: '@typescript-eslint/parser',
  plugins: ['eslint-plugin-tsdoc'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
    ecmaVersion: 2019,
    sourceType: 'module',
  },
  ignorePatterns: [
    'lib/*',
    'client/*'
  ],
  rules: {
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-use-before-define': ['error', 'nofunc'],
    '@typescript-eslint/no-floating-promises': ['error', {'ignoreVoid': true}],
    'no-warning-comments': 'warn',
    'tsdoc/syntax': 'error',
    '@typescript-eslint/no-var-requires': 'warn',
  }
};
