/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/rosetta/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/rosetta/setup.ts',
  globalTeardown: '<rootDir>/tests/rosetta/teardown.ts',
  testTimeout: 60_000,
  verbose: true,
};

module.exports = config;
