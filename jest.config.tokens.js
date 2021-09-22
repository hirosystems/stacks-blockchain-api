module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: 'src',
    testMatch: ['<rootDir>/tests-tokens/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-tokens/setup.ts', '<rootDir>/tests-tokens/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests'],
    coverageDirectory: '../coverage',
    globalSetup: '<rootDir>/tests-tokens/setup.ts',
    globalTeardown: '<rootDir>/tests-tokens/teardown.ts',
    testTimeout: 60000,
  }
