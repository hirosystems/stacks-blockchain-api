module.exports = {
    preset: 'ts-jest',
    rootDir: `${require('path').dirname(__dirname)}/src`,
    testMatch: ['<rootDir>/tests-tokens-metadata/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-tokens-metadata/setup.ts', '<rootDir>/tests-tokens-metadata/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '<rootDir>/../coverage',
    globalSetup: '<rootDir>/tests-tokens-metadata/setup.ts',
    globalTeardown: '<rootDir>/tests-tokens-metadata/teardown.ts',
    testTimeout: 60000,
    verbose: true,
  }
