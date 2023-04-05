module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-2.1-transition/**/*.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests-2.1-transition/global-setup.ts',
    '<rootDir>/tests-2.1-transition/global-teardown.ts',
    '<rootDir>/tests-2.1-transition/env-setup.ts',
  ],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests-2.1-transition/global-setup.ts',
  globalTeardown: '<rootDir>/tests-2.1-transition/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests-2.1-transition/env-setup.ts'],
  testTimeout: 120000,
  verbose: true,
};
