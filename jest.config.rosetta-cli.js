module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/tests-rosetta-cli/validate-rosetta-construction.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests-rosetta-cli/setup.ts',
    '<rootDir>/tests-rosetta-cli/teardown.ts',
  ],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests'],
  coverageDirectory: '../coverage',
  globalSetup: '<rootDir>/tests-rosetta-cli/setup.ts',
  globalTeardown: '<rootDir>/tests-rosetta-cli/teardown.ts',
  testTimeout: 180000,
  transformIgnorePatterns: ['node_modules/(?!(@blockstack/stacks-transactions)/)'],
};
