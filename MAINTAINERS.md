# Maintainer's guide

This guide is intended for maintainers — anybody with commit access to this repository.

*Note:* This guide is a living standard;
that is, it is meant to *describe* the project's maintenance practices,
rather than *prescribe* them.
As a maintainer, you're expected to refer to it for clarifications
about the collaborative workflows of the project,
but also to propose changes to it
that you feel would make it more useful
as a guideline for current and future maintainers.

We use the [git flow methodology](http://nvie.com/posts/a-successful-git-branching-model/) for
managing this repository. At a glance, this means:

- a **master** branch. This branch MUST be releasable at all times. Commits and merges against
  this branch MUST contain only bugfixes and/or security fixes. Maintenance releases are tagged
  against master.
- a **develop** branch. This branch contains *new features*, and will either become the next minor
  (feature) release or next major release. Typically, major releases are reserved for backwards
  *incompatible* changes, but can also be used to signal major new features.

## I. Branch Naming Conventions

- In addition to master and develop branches, these are the standards for features, fixes, chores and releases, 
  1. **features** All feature branches must be created under **feat/**,
  2. **bug-fixes** All fixes must be created under **fix/**,
  3. **chores** Ad-hoc tasks that are not features, minor housekeeping, maintenance tasks should be created under **chores/**
  4. Avoid branches being grouped under your usernames
  
## II. Handling PRs

- When creating a PR, you should:
  1. Clearly describe the intent of the PR 
  2. Describe the solution in detail with links to the original issue and any related issues that it might fix or close. 
  3. GitHub Draft PRs are a great way to get CI or human feedback on work that isn't yet ready to merge. PRs can be created as drafts and converted to normal PRs once the CI passes. More information about GitHub Draft PRs: https://github.blog/2019-02-14-introducing-draft-pull-requests/
  

- PRs should be merged once they
  1.  **pass the automated tests** (GitHub Actions, CLA signing, etc.),
  2.  have the **review comments addressed**,
  3.  get **approved reviews by two maintainers**, (the second maintainer can merge immediately after approving) and
  4.  have been open for at least **24 hours** unless the changes are trivial

- To merge a pull request, it must have at least:

  - one approval for simple documentation fixes
  - two approvals for everything else

- When merging a PR, you should:

  1. Use the **merge strategy that produces a clean Git history**: ["Squash and merge"](https://help.github.com/en/github/collaborating-with-issues-and-pull-requests/about-pull-request-merges#squash-and-merge-your-pull-request-commits) commits and ensure the resulting commit message is:
    - descriptive
    - sentence case
    - If instead the PR author took the time to craft individual, informative messages for each commit, then use the `Rebase and merge` method,to honor that work and preserve the history of the changes.
    - For less clear-cut cases, a simple heuristic you can follow is that if there are more "dirty" commits than "clean" commits,then prefer squash, else do a rebase.

  2. Ensure [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) are used in the PR. When properly annotated, the commit messages will automatically update the changelog.
  

- If a PR fails to get a review from a second maintainer after a few days, the first maintainer should ping others for review. If it still lingers around for **over a week without a second maintainer’s approval**,the first maintainer can go ahead and merge it.

- If the only issues holding up a merge are **trivial fixes**
  (typos, syntax errors, etc.), and the author doesn't respond in a day or two,
  **maintainers can make the necessary changes themselves**,
  and proceed with the merge process.

- If a PR **stops getting feedback from the submitter** and is marked as stale
  by [probot-stale](../.github/workflows/stale.yml),
  any maintainer can choose to take over the PR
  and make the necessary changes to get the content ready for merging.

- **Avoid merging your own PRs** unless approved by other maintainers.
