module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  globalSetup: '<rootDir>/tests/setup.ts',
  transformIgnorePatterns: [
    "node_modules/(?!(@blockstack/stacks-transactions)/)"
  ]
}
