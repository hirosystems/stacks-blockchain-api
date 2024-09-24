/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/rosetta-cli-construction/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/rosetta-cli-construction/setup.ts',
  globalTeardown: '<rootDir>/tests/rosetta-cli-construction/teardown.ts',
  testTimeout: 180000,
  verbose: true,
};

module.exports = config;
