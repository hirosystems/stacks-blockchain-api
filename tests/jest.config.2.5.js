/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/2.5/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/2.5/global-setup.ts',
  globalTeardown: '<rootDir>/tests/2.5/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/2.5/env-setup.ts'],
  testTimeout: 60_000,
  verbose: true,
  bail: true,
};

module.exports = config;
