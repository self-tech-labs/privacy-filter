# Release

## Public surfaces

- Desktop app releases are published from this repository.
- The public landing page is built from `site/` and deployed through GitHub Pages.
- The desktop app frontend is built from `src/`.

## GitHub release assets

- GitHub automatically adds `Source code (zip)` and `Source code (tar.gz)` to
  every tagged release.
- Those archives are snapshots of the repository source, not installable macOS
  application builds.
- A real public macOS release for this project should include:
  - a `.dmg` installer
  - the `.app.tar.gz` updater archive
  - the matching `.app.tar.gz.sig` signature
  - `latest.json` for updater metadata
- Do not publish unsigned or unstapled macOS artifacts as the public download.

## Local verification

Run the full validation suite before cutting a release:

```bash
npm run check
```

## Desktop artifacts

- `npm run release:mac:app`
  - Builds the `.app` bundle
  - Signs the updater archive with the local Tauri updater private key
  - Writes `src-tauri/target/release/bundle/updater/latest.json`
- `npm run release:mac:dmg`
  - Builds the downloadable DMG only
- `npm run release:mac:all`
  - Produces both updater and DMG artifacts

## GitHub Actions release workflow

This repository includes [release-macos.yml](../.github/workflows/release-macos.yml)
for tagged or manual macOS releases.

It expects these GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if your updater key is password-protected
- `APPLE_CERTIFICATE` as base64-encoded `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_API_PRIVATE_KEY` with the App Store Connect `.p8` contents
- `APPLE_SIGNING_IDENTITY` optionally, if you do not want the workflow to infer it

Without those secrets, the workflow should fail fast instead of publishing a
misleading release that only contains GitHub's default source archives.

## Updater key

The updater public key lives in `src-tauri/tauri.conf.json`.

The updater private key must stay local. By default this repo expects it at:

```text
.tauri/updater/private.key
```

Generate it once with:

```bash
npx tauri signer generate -- -w .tauri/updater/private.key
```

If you prefer a different location, set `TAURI_SIGNING_PRIVATE_KEY` before
running the release scripts.

## GitHub Pages build

Build the landing site locally with:

```bash
npm run site:build
```

Smoke-test that the site bundle does not include desktop model assets:

```bash
npm run site:check
```

## macOS signing and notarization

For browser-download distribution, provide a real Developer ID identity and
notarization credentials before running the release scripts.

Common environment variables:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_KEY="KEYID"
export APPLE_API_ISSUER="ISSUER-UUID"
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_KEYID.p8"
```

Alternative Apple ID flow:

```bash
export APPLE_ID="name@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

`.env` files do not work for Tauri updater signing. Export variables in the
active shell or inject them in CI.
