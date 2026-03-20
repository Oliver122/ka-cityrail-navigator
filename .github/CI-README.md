# CI/CD Documentation

This project uses GitHub Actions for continuous integration and deployment.

## Workflows

### 1. PR Validation (`pr-validation.yml`)

**Trigger:** Pull requests to `development` or `main`

Validates that the code compiles successfully. Builds a single architecture (aarch64) for speed.

```
PR opened/updated → Build validation → ✅ Pass or ❌ Fail
```

### 2. Auto Version (`auto-version.yml`)

**Trigger:** Push to `main` (after PR merge)

Automatically determines version bump based on the merged branch name and creates a release.

#### Versioning Rules

| Branch Pattern | Commit Tag | Version Bump | Example |
|----------------|------------|--------------|---------|
| `fix/*` | `[fix]` | Patch (0.0.X) | v1.0.0 → v1.0.1 |
| `feat/*` | `[feat]` | Minor (0.X.0) | v1.0.0 → v1.1.0 |
| `bc/*` or `breaking-change/*` | `[breaking]` | Major (X.0.0) | v1.0.0 → v2.0.0 |

**Actions performed:**
1. Calculates new version from latest git tag
2. Updates version in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
3. Commits version bump
4. Creates git tag (e.g., `v1.2.3`)
5. Creates GitHub Release with auto-generated notes

### 3. Release Build (`release-build.yml`)

**Trigger:** GitHub Release published

Builds signed Android artifacts and attaches them to the release.

**Outputs:**
- `ka-cityrail-navigator-vX.X.X.aab` - Android App Bundle (Play Store)
- `ka-cityrail-navigator-vX.X.X.apk` - APK (Direct install)

---

## Flow Diagram

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   PR Created     │     │  Merge to Main   │     │ Release Created  │
│                  │     │                  │     │                  │
│  feat/my-feature │────▶│  auto-version    │────▶│  release-build   │
│                  │     │  detects "feat/" │     │                  │
└──────────────────┘     │  bumps to v0.2.0 │     │  builds signed   │
        │                │  creates release │     │  APK + AAB       │
        ▼                └──────────────────┘     └──────────────────┘
┌──────────────────┐
│  pr-validation   │
│  (build check)   │
└──────────────────┘
```

---

## Required Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore file | `base64 -w0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | Your keystore password |
| `ANDROID_KEY_ALIAS` | Signing key alias | Usually `release` or `upload` |
| `ANDROID_KEY_PASSWORD` | Signing key password | Your key password |
| `PLAY_STORE_SERVICE_ACCOUNT_JSON` | Google Play API credentials | [See below](#play-store-setup) |

### Creating a Keystore

```bash
keytool -genkey -v -keystore release.keystore -alias release -keyalg RSA -keysize 2048 -validity 10000
```

### Encoding Keystore for GitHub

```bash
# Linux/macOS
base64 -w0 release.keystore | xclip -selection clipboard

# Or save to file
base64 -w0 release.keystore > keystore.b64
```

---

## Optional Variables

Configure in **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value | Description |
|----------|-------|-------------|
| `AUTO_PUBLISH_PLAYSTORE` | `true` | Automatically upload to Play Store on release |

---

## Play Store Setup

To enable automatic Play Store uploads:

1. Go to [Google Play Console](https://play.google.com/console)
2. Navigate to **Settings → API access**
3. Create a new service account or link existing
4. Grant **Release manager** permissions
5. Download the JSON key file
6. Add the entire JSON content as `PLAY_STORE_SERVICE_ACCOUNT_JSON` secret

---

## Branch Naming Convention

Use these prefixes for automatic version bumping:

```
fix/issue-123-button-bug      → Patch release (0.0.X)
feat/add-dark-mode            → Minor release (0.X.0)
bc/new-api-format             → Major release (X.0.0)
breaking-change/v2-migration  → Major release (X.0.0)
```

---

## Manual Version Override

If you need to set a specific version manually:

```bash
# Update all version files
npm version 2.0.0 --no-git-tag-version
sed -i 's/"version": "[^"]*"/"version": "2.0.0"/' src-tauri/tauri.conf.json
sed -i '0,/^version = /s/^version = "[^"]*"/version = "2.0.0"/' src-tauri/Cargo.toml

# Commit and tag
git add -A
git commit -m "chore: bump version to v2.0.0"
git tag v2.0.0
git push && git push --tags
```

---

## Troubleshooting

### Build fails with keystore error
- Verify `ANDROID_KEYSTORE_BASE64` is correctly encoded
- Check that alias and passwords match your keystore

### Version not bumping correctly
- Ensure branch name starts with `fix/`, `feat/`, `bc/`, or `breaking-change/`
- Check the merge commit message in the Actions log

### Play Store upload fails
- Verify service account has correct permissions
- Ensure app is already created in Play Console
- Check package name matches `com.oliver.ka-cityrail-navigator`
