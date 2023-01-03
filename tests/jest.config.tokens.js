module.exports = {
    preset: 'ts-jest',
    rootDir: `${require('path').dirname(__dirname)}/src`,
    testMatch: ['<rootDir>/tests-tokens/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-tokens/setup.ts', '<rootDir>/tests-tokens/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '<rootDir>/../coverage',
    globalSetup: '<rootDir>/tests-tokens/setup.ts',
    globalTeardown: '<rootDir>/tests-tokens/teardown.ts',
    testTimeout: 60000,
    verbose: true,
  }
