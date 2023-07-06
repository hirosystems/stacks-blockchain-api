/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-bns-e2e/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests-bns-e2e/setup.ts', '<rootDir>/tests-bns-e2e/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests-bns-e2e/setup.ts',
  globalTeardown: '<rootDir>/tests-bns-e2e/teardown.ts',
  testTimeout: 60000,
  verbose: true,
};

module.exports = config;
