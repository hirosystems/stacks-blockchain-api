module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/tests-rosetta-cli-data/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests-rosetta-cli-data/setup.ts', '<rootDir>/tests-rosetta-cli-data/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests'],
  coverageDirectory: '../coverage',
  globalSetup: '<rootDir>/tests-rosetta-cli-data/setup.ts',
  globalTeardown: '<rootDir>/tests-rosetta-cli-data/teardown.ts',
  testTimeout: 240000,
  transformIgnorePatterns: [
    "node_modules/(?!(@stacks/stacks-transactions)/)"
  ]
};
