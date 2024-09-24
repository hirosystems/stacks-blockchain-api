module.exports = {
  preset: 'ts-jest',
  rootDir: `${require('path').dirname(__dirname)}`,
  testMatch: ['<rootDir>/tests/btc-faucet/*.test.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  globalSetup: '<rootDir>/tests/btc-faucet/setup.ts',
  globalTeardown: '<rootDir>/tests/btc-faucet/teardown.ts',
  testTimeout: 60000,
};
