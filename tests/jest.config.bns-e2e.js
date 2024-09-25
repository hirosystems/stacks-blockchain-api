/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/bns-e2e/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/bns-e2e/setup.ts',
  globalTeardown: '<rootDir>/tests/bns-e2e/teardown.ts',
  testTimeout: 3600000,
  verbose: true,
};

module.exports = config;
