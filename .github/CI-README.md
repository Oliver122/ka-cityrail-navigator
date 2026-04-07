# CI/CD Documentation

This project uses GitHub Actions for continuous integration and deployment.

## Workflows

### 1. PR Validation (`pr-validation.yml`)

**Trigger:** Pull requests to `development` or `main`

Validates that the code compiles successfully. Builds a single architecture (aarch64) for speed.

```
PR opened/updated → Build validation → ✅ Pass or ❌ Fail
```

### 2. Dev Build (`dev-build.yml`)

**Trigger:** Push to `development`

Builds and signs an Android dev APK after quality checks.

#### Versioning Rules (based on latest commit message)

| Commit Prefix | Version Bump | Example |
|---------------|--------------|---------|
| `[fix]` | Patch (0.0.X) | v1.0.0 → v1.0.1 |
| `[feat]` | Minor (0.X.0) | v1.0.0 → v1.1.0 |
| `[cicd]` | Patch (0.0.X) | v1.0.0 → v1.0.1 |

**Actions performed:**
1. Calculates next prerelease tag (`vX.Y.Z-dev.N`)
2. Runs typecheck and runtime smoke tests
3. Builds and signs arm64 APK
4. Uploads artifacts and creates a prerelease

### 3. Release (`release.yml`)

**Trigger:** Push to `main`

Calculates release version, tags release, builds signed Android artifacts, and optionally uploads to Play Store.

**Outputs:**
- `ka-cityrail-navigator-vX.X.X.aab` - Android App Bundle (Play Store)
- `ka-cityrail-navigator-vX.X.X.apk` - APK (Direct install)

---

## Flow Diagram

```
PR opened/updated
  -> pr-validation.yml
     -> quality checks (typecheck + tests + build)
     -> android-validation (init + manifest check + apk build)

Push to development
  -> dev-build.yml
     -> quality checks
     -> android config validation
     -> signed dev apk prerelease

Push to main
  -> release.yml
     -> version + tag + release creation
     -> android config validation
     -> signed aab + apk artifacts
     -> optional play store upload
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

## Commit Convention

Use commit prefixes to drive release semantics:

```
[fix] short description   -> patch bump
[feat] short description  -> minor bump
[cicd] short description  -> CI/CD-only patch bump
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
- Ensure commit message starts with `[fix]` or `[feat]`
- Check the latest commit message in the Actions log

### Play Store upload fails
- Verify service account has correct permissions
- Ensure app is already created in Play Console
- Check package name matches `com.oliver.ka-cityrail-navigator`
