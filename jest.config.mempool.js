module.exports = {
  preset: 'ts-jest',
  rootDir: 'src',
  testMatch: ['<rootDir>/tests-mempool/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests-mempool/setup.ts', '<rootDir>/tests-mempool/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '../coverage',
  globalSetup: '<rootDir>/tests-mempool/setup.ts',
  globalTeardown: '<rootDir>/tests-mempool/teardown.ts',
  testTimeout: 60000,
}
