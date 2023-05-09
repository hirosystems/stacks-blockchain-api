module.exports = {
    preset: 'ts-jest',
    rootDir: `${require('path').dirname(__dirname)}/src`,
    testMatch: ['<rootDir>/tests-tokens-strict/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-tokens-strict/setup.ts', '<rootDir>/tests-tokens-strict/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '<rootDir>/../coverage',
    globalSetup: '<rootDir>/tests-tokens-strict/setup.ts',
    globalTeardown: '<rootDir>/tests-tokens-strict/teardown.ts',
    testTimeout: 60000,
    verbose: true,
  }
