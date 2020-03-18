module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'eslint-plugin-tsdoc',
  ],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: [
      './tsconfig.json',
    ],
    ecmaVersion: 2019,
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: [
    'lib/*',
  ],
  rules: {
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/no-use-before-define': ['error', 'nofunc'],
    '@typescript-eslint/no-floating-promises': 'error',
    'no-warning-comments': 'warn',
    'tsdoc/syntax': 'error',
  }
};
