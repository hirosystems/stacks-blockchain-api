/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-2.1/**/*.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests-2.1/global-setup.ts', 
    '<rootDir>/tests-2.1/global-teardown.ts', 
    '<rootDir>/tests-2.1/env-setup.ts',
    '<rootDir>/tests-2.1/test-helpers.ts',
  ],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests-2.1/global-setup.ts',
  globalTeardown: '<rootDir>/tests-2.1/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests-2.1/env-setup.ts'],
  testTimeout: 60_000,
  verbose: true,
  bail: true,
};

module.exports = config;
