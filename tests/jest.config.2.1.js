module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: `${require('path').dirname(__dirname)}`,
  // globals: { 'ts-jest': { tsConfig: tsConfigPath } },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {tsconfig: `${require('path').resolve(__dirname, '../tsconfig.json')}`},
    ],
  },
  testMatch: ['<rootDir>/src/tests-2.1/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/src/tests-2.1/global-setup.ts', '<rootDir>/src/tests-2.1/global-teardown.ts', '<rootDir>/src/tests-2.1/env-setup.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/src/tests*'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/src/tests-2.1/global-setup.ts',
  globalTeardown: '<rootDir>/src/tests-2.1/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/src/tests-2.1/env-setup.ts'],
  testTimeout: 60000,
}
