module.exports = {
    preset: 'ts-jest',
    rootDir: 'src',
    testMatch: ['<rootDir>/tests-btc/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-btc/setup.ts', '<rootDir>/tests-btc/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '../coverage',
    globalSetup: '<rootDir>/tests-btc/setup.ts',
    globalTeardown: '<rootDir>/tests-btc/teardown.ts',
    globals: {
      'ts-jest': {
        diagnostics: false
      }
    },
    testTimeout: 60000,
  }
