/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/snp/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  moduleNameMapper: {
    '^typebox$': '@sinclair/typebox',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/snp/env-setup.ts'],
  testTimeout: 60_000,
  verbose: true,
  bail: true,
};

module.exports = config;
