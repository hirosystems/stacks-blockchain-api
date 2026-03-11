module.exports = {
  preset: 'ts-jest',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/bns/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  moduleNameMapper: {
    '^typebox$': '@sinclair/typebox',
  },
  globalSetup: '<rootDir>/tests/bns/setup.ts',
  globalTeardown: '<rootDir>/tests/bns/teardown.ts',
  testTimeout: 60000,
};
