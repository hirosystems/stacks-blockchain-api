module.exports = {
    preset: 'ts-jest',
    rootDir: `${require('path').dirname(__dirname)}/src`,
    testMatch: ['<rootDir>/tests-bns/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-bns/setup.ts', '<rootDir>/tests-bns/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '<rootDir>/../coverage',
    globalSetup: '<rootDir>/tests-bns/setup.ts',
    globalTeardown: '<rootDir>/tests-bns/teardown.ts',
    testTimeout: 60000,
  }
