module.exports = {
  preset: 'ts-jest',
  rootDir: `${require('path').dirname(__dirname)}/src`,
  testMatch: ['<rootDir>/tests-2.1/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests-2.1/setup.ts', '<rootDir>/tests-2.1/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests*'],
  coverageDirectory: '<rootDir>/../coverage',
  setupFilesAfterEnv: ['<rootDir>/tests-2.1/setup.ts'],
  testTimeout: 60000,
}
