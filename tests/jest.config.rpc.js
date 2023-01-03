module.exports = {
    preset: 'ts-jest',
    rootDir: `${require('path').dirname(__dirname)}/src`,
    testMatch: ['<rootDir>/tests-rpc/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-rpc/setup.ts', '<rootDir>/tests-rpc/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '<rootDir>/../coverage',
    globalSetup: '<rootDir>/tests-rpc/setup.ts',
    globalTeardown: '<rootDir>/tests-rpc/teardown.ts',
    testTimeout: 60000,
  }
