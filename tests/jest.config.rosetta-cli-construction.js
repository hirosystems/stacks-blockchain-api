/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-rosetta-cli-construction/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests-rosetta-cli-construction/setup.ts', '<rootDir>/tests-rosetta-cli-construction/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests-rosetta-cli-construction/setup.ts',
  globalTeardown: '<rootDir>/tests-rosetta-cli-construction/teardown.ts',
  testTimeout: 180000,
  verbose: true,
};

module.exports = config;
