module.exports = {
   preset: 'ts-jest',
   rootDir: `${require('path').dirname(__dirname)}/src`,
   testMatch: ['<rootDir>/tests-rosetta/**/*.ts'],
   testPathIgnorePatterns: ['<rootDir>/tests-rosetta/setup.ts', '<rootDir>/tests-rosetta/teardown.ts'],
   collectCoverageFrom: ['<rootDir>/**/*.ts'],
   coveragePathIgnorePatterns: ['<rootDir>/tests*'],
   coverageDirectory: '<rootDir>/../coverage',
   globalSetup: '<rootDir>/tests-rosetta/setup.ts',
   globalTeardown: '<rootDir>/tests-rosetta/teardown.ts',
   testTimeout: 60000,
 }
