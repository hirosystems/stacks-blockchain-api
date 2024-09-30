/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/rosetta-cli-data/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/rosetta-cli-data/setup.ts',
  globalTeardown: '<rootDir>/tests/rosetta-cli-data/teardown.ts',
  testTimeout: 240000,
  verbose: true,
};

module.exports = config;
