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
    '@typescript-eslint/no-unsafe-assignment': 'off', // TODO: re-enable in a future linting refactor
    '@typescript-eslint/no-unsafe-member-access': 'off', // TODO: re-enable in a future linting refactor
    '@typescript-eslint/no-unsafe-call': 'off', // TODO: re-enable in future linting refactor
    '@typescript-eslint/no-misused-promises': 'warn', // TODO: disabled because of a typing bug with @awaitjs/express routes
    '@typescript-eslint/no-use-before-define': ['error', 'nofunc'],
    '@typescript-eslint/no-floating-promises': ['error', {'ignoreVoid': true}],
    'no-warning-comments': 'warn',
    'tsdoc/syntax': 'error',
  }
};
