/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-subnets/**/*.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests-subnets/global-setup.ts', 
    '<rootDir>/tests-subnets/global-teardown.ts', 
    '<rootDir>/tests-subnets/env-setup.ts',
    '<rootDir>/tests-subnets/test-helpers.ts',
    '<rootDir>/tests-subnets/set-env.ts',
  ],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests-subnets/global-setup.ts',
  globalTeardown: '<rootDir>/tests-subnets/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests-subnets/env-setup.ts'],
  setupFiles: ['<rootDir>/tests-subnets/set-env.ts'],
  testTimeout: 60_000,
  verbose: true,
  bail: true,
};

module.exports = config;
