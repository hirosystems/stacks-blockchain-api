module.exports = {
    preset: 'ts-jest',
    rootDir: 'src',
    testMatch: ['<rootDir>/tests-bns/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-bns/setup.ts', '<rootDir>/tests-bns/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '../coverage',
    globalSetup: '<rootDir>/tests-bns/setup.ts',
    globalTeardown: '<rootDir>/tests-bns/teardown.ts',
    testTimeout: 60000,
  }
