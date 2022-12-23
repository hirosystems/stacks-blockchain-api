module.exports = {
  preset: 'ts-jest',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests/setup.ts', '<rootDir>/tests/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  globalSetup: '<rootDir>/tests/setup.ts',
  globalTeardown: '<rootDir>/tests/teardown.ts',
  testTimeout: 20000,
}
