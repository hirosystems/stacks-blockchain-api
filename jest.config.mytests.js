module.exports = {
  preset: 'ts-jest',
  rootDir: 'src',
  testMatch: ['<rootDir>/tests/my-tests/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests/setup.ts', '<rootDir>/tests/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '../coverage',
  globalSetup: '<rootDir>/tests/setup.ts',
  globalTeardown: '<rootDir>/tests/teardown.ts',
  testTimeout: 20000,
}
