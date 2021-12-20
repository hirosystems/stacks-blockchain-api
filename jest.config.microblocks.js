module.exports = {
    preset: 'ts-jest',
    rootDir: 'src',
    testMatch: ['<rootDir>/tests-microblocks/*.ts'],
    testPathIgnorePatterns: ['<rootDir>/tests-microblocks/setup.ts', '<rootDir>/tests-microblocks/teardown.ts'],
    collectCoverageFrom: ['<rootDir>/**/*.ts'],
    coveragePathIgnorePatterns: ['<rootDir>/tests*'],
    coverageDirectory: '../coverage',
    globalSetup: '<rootDir>/tests-microblocks/setup.ts',
    globalTeardown: '<rootDir>/tests-microblocks/teardown.ts',
    testTimeout: 5000,
  }
