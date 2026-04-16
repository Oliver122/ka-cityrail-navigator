#!/usr/bin/env bash
#
# Usage: ./scripts/sync-version.sh 0.2.0
#
# Updates the version in all three project manifests:
#   - package.json
#   - src-tauri/tauri.conf.json
#   - src-tauri/Cargo.toml
#
set -euo pipefail

VERSION="${1:?Usage: $0 <version>  (e.g. 0.2.0)}"
VERSION="${VERSION#v}"  # strip leading 'v' if present

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Syncing version → $VERSION"

# package.json (+ package-lock.json)
cd "$ROOT"
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null

# tauri.conf.json
node -e "
  const fs = require('fs');
  const path = '$ROOT/src-tauri/tauri.conf.json';
  const conf = JSON.parse(fs.readFileSync(path, 'utf8'));
  conf.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(conf, null, 2) + '\n');
"

# Cargo.toml (first version = line in [package])
sed -i "0,/^version = /s/^version = \"[^\"]*\"/version = \"$VERSION\"/" "$ROOT/src-tauri/Cargo.toml"

echo "Updated:"
echo "  package.json        → $VERSION"
echo "  tauri.conf.json     → $VERSION"
echo "  Cargo.toml          → $VERSION"
echo ""
echo "Next steps:"
echo "  git add -u && git commit -m 'chore: set version to v$VERSION'"
echo "  git tag v$VERSION && git push origin v$VERSION"
