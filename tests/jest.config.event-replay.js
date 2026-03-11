module.exports = {
  preset: 'ts-jest',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/event-replay/**/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  moduleNameMapper: {
    '^typebox$': '@sinclair/typebox',
  },
  globalSetup: '<rootDir>/tests/event-replay/setup.ts',
  globalTeardown: '<rootDir>/tests/event-replay/teardown.ts',
  testTimeout: 20000,
};
