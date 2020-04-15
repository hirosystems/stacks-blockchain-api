module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/tests/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: ['<rootDir>/**/*.ts'],
  coverageDirectory: '../coverage',
  globalSetup: '<rootDir>/tests/setup.ts',
  transformIgnorePatterns: [
    "node_modules/(?!(@blockstack/stacks-transactions)/)"
  ]
}
