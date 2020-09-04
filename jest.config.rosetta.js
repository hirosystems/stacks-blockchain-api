module.exports = {
   preset: 'ts-jest',
   testEnvironment: 'node',
   rootDir: 'src',
   testMatch: ['<rootDir>/tests-rosetta/**/*.ts'],
   testPathIgnorePatterns: ['<rootDir>/tests-rosetta/setup.ts', '<rootDir>/tests-rosetta/teardown.ts'],
   collectCoverageFrom: ['<rootDir>/**/*.ts'],
   coveragePathIgnorePatterns: ['<rootDir>/tests'],
   coverageDirectory: '../coverage',
   globalSetup: '<rootDir>/tests-rosetta/setup.ts',
   globalTeardown: '<rootDir>/tests-rosetta/teardown.ts',
   testTimeout: 60000,
   transformIgnorePatterns: [
     "node_modules/(?!(@blockstack/stacks-transactions)/)"
   ]
 }
