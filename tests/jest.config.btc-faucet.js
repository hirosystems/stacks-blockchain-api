module.exports = {
    preset: 'ts-jest',
    rootDir: `${require('path').dirname(__dirname)}/src`,
    testMatch: ['<rootDir>/tests-btc-faucet/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-btc-faucet/setup.ts', '<rootDir>/tests-btc-faucet/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '<rootDir>/../coverage',
    globalSetup: '<rootDir>/tests-btc-faucet/setup.ts',
    globalTeardown: '<rootDir>/tests-btc-faucet/teardown.ts',
    testTimeout: 60000,
  }
