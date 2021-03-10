module.exports = {
  root: true,
  extends: ['@stacks/eslint-config'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
    ecmaVersion: 2017,
    sourceType: 'module',
  },
  ignorePatterns: ['lib/*', 'test/*', '.eslintrc.js'],
  rules: {},
};
