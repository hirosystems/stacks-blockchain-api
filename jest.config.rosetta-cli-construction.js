module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/tests-rosetta-cli-construction/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests-rosetta-cli-construction/setup.ts', '<rootDir>/tests-rosetta-cli-construction/teardown.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/tests'],
  coverageDirectory: '../coverage',
  globalSetup: '<rootDir>/tests-rosetta-cli-construction/setup.ts',
  globalTeardown: '<rootDir>/tests-rosetta-cli-construction/teardown.ts',
  testTimeout: 180000,
  transformIgnorePatterns: [
    "node_modules/(?!(@stacks/stacks-transactions)/)"
  ]
}
