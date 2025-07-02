# Workplan: Improve Developer Experience and CI Robustness

- **Task ID**: `IMPROVE-DX-SETUP`
- **Status**: Not Started

## Problem Statement

The current local development setup for the Stacks Blockchain API is powerful but suffers from several issues that increase onboarding time and create friction for developers. Key problems include:
1.  **Brittle Docker Configurations**: The `dev:integrated` script fails due to undefined environment variables in the `rosetta-cli` service, preventing the primary development workflow from running.
2.  **Fragile Test Runner**: The `test:integration` script fails because it references a non-existent root `jest.config.js` file, making it difficult to run a full test suite locally.
3.  **Workflow Complexity**: The high number of Docker-compose files and npm scripts makes it difficult for developers to know where to start or how to run the system for different scenarios.
4.  **Documentation Gaps**: There is no centralized guide for troubleshooting common setup problems, forcing developers to resort to trial-and-error.

## Proposed Solution

This proposal outlines a series of minimal, non-disruptive changes to address these issues, focusing on improving developer experience and making the local environment more resilient and easier to use.

### 1. Fix Docker Compose Configuration

The `docker-compose.dev.rosetta-cli.yml` file will be updated to provide default values for the `CMD` and `OUTPUT` environment variables. This ensures that Docker compose commands can run without requiring these variables to be set externally, fixing the `npm run dev:integrated` script.

### 2. Introduce a Root Jest Configuration

A new root `jest.config.js` will be created. This file will not contain any project-specific configuration but will serve as a baseline, allowing Jest's test runner to find the project root correctly. The `test:integration` script will be updated to use this root config, which will, in turn, discover and run all test suites defined in the `test` directory.

### 3. Simplify and Add Test Orchestration Scripts

New npm scripts will be added to `package.json` to simplify common workflows:
-   `test:all`: A new script to run all major test suites sequentially, simulating the CI process locally.
-   `dev:clean`: A utility script to gracefully stop and remove all Docker containers and network resources associated with the development environment.

### 4. Create a Troubleshooting Guide

A new `TROUBLESHOOTING.md` document will be added to the `docs/` directory. This document will provide solutions to common problems, such as port conflicts, database connection issues, and Docker environment failures.

## Automated Test Plan

The existing comprehensive test suites will be used to validate these changes. The primary success metric is that all existing tests continue to pass after the proposed changes are implemented. The new `test:all` script will serve as the primary tool for this verification.

## Components Involved

-   `package.json` (to add new scripts)
-   `docker/docker-compose.dev.rosetta-cli.yml` (to fix environment variables)
-   `tests/` (to add a root `jest.config.js`)
-   `docs/` (to add `TROUBLESHOOTING.md`)

## Dependencies

There are no external dependencies required for these changes.

## Implementation Checklist

- [ ] **Fix Rosetta Docker Compose**:
    - [ ] Edit `docker/docker-compose.dev.rosetta-cli.yml`.
    - [ ] Provide default values for `CMD` and `OUTPUT` variables (e.g., `CMD: "validate"` and `OUTPUT: "/rosetta-cli-output"`).
- [ ] **Add Root Jest Config**:
    - [ ] Create a new `jest.config.js` file in the project root.
    - [ ] Add minimal configuration to delegate to test-suite-specific configs.
- [ ] **Enhance `npm` Scripts**:
    - [ ] Add `test:all` to `package.json` to run all test suites.
    - [ ] Add `dev:clean` to `package.json` for easy environment teardown.
- [ ] **Create Documentation**:
    - [ ] Create `docs/TROUBLESHOOTING.md`.
    - [ ] Add content covering common setup issues and their solutions.

## Verification Steps

1.  Run `npm run dev:integrated`. The command should complete successfully without the "invalid empty volume spec" error.
2.  Run `npm run test:integration`. The test runner should now start and execute the test suites.
3.  Run the new `npm run test:all` script and verify that all major test suites are executed.
4.  Run the new `npm run dev:clean` script and verify that all development containers are stopped and removed.
5.  Review the `docs/TROUBLESHOOTING.md` file for clarity and accuracy.

## Decision Authority

These changes fall within the scope of technical implementation and developer experience improvements. They do not alter business logic or major architectural patterns, and therefore do not require external approval.

## Questions/Uncertainties

-   **Non-blocking**: The exact set of test suites to include in `test:all` can be refined during implementation to balance coverage and execution time.

## Acceptable Tradeoffs

-   The proposed changes will add a few new files and scripts to the repository, but the resulting improvement in developer workflow and reduction in setup friction is a worthwhile tradeoff. 
