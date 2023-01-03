module.exports = {
  preset: 'ts-jest',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-event-replay/**/*.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests-event-replay/setup.ts',
    '<rootDir>/tests-event-replay/teardown.ts',
  ],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests-event-replay/setup.ts',
  globalTeardown: '<rootDir>/tests-event-replay/teardown.ts',
  testTimeout: 20000,
};
