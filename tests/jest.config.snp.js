/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/snp/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/snp/jest-global-setup.ts',
  globalTeardown: '<rootDir>/tests/snp/jest-global-teardown.ts',
  testTimeout: 60_000,
  verbose: true,
  bail: true,
};

module.exports = config;
