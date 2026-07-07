#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "  e.g. $0 1.3.0"
  echo "  e.g. $0 1.3.0-beta.0"
  exit 1
fi

# Strip leading 'v' if provided
VERSION="${VERSION#v}"
TAG="v${VERSION}"

# Ensure we're on a clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure we're up to date with remote
git fetch origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${BRANCH}")" ]; then
  echo "Error: Local branch '${BRANCH}' is not up to date with origin. Pull or push first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag '${TAG}' already exists."
  exit 1
fi

echo "Updating version to ${VERSION} (tag ${TAG}) on branch ${BRANCH}"
echo ""

# Update root package.json and package-lock.json
echo "Updating root package.json..."
npm version "$VERSION" --no-git-tag-version
echo "Updating client/package.json..."
npm version "$VERSION" --no-git-tag-version --prefix client

# Regenerate OpenAPI spec with new version
echo "Regenerating OpenAPI spec..."
npm run generate:openapi
echo "Regenerating client types..."
npm run generate:client

echo ""
echo "Done! Version ${VERSION} updated in all package files."
echo "Next steps:"
echo "  Create and merge Pull Request with version bump"
echo "  Push the tag: git tag v${VERSION} && git push --tags"
echo "  Trigger the Release workflow via GitHub UI with version: ${VERSION}"
