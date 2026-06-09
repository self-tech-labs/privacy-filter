# Release

## Public surfaces

- Desktop app releases are published from this repository.
- The public landing page is built from `site/` and deployed through GitHub Pages.
- The desktop app frontend is built from `src/`.

## GitHub release assets

- GitHub automatically adds `Source code (zip)` and `Source code (tar.gz)` to
  every tagged release.
- Those archives are snapshots of the repository source, not installable
  desktop application builds.
- A real public macOS release for this project should include:
  - a `.dmg` installer
  - `Privacy-Filter-macOS.dmg` as a stable website download alias
  - the `.app.tar.gz` updater archive
  - the matching `.app.tar.gz.sig` signature
  - `latest.json` for updater metadata
- Do not publish unsigned or unstapled macOS artifacts as the public download.
- A real public Windows release for this project should include:
  - a setup `.exe` installer from the NSIS bundle
  - `Privacy-Filter-Windows.exe` as a stable website download alias
  - the matching `.exe.sig` updater signature
  - `latest-windows.json` for Windows updater metadata
- Code signing is not required to build a Windows installer, but public browser
  downloads should be signed to reduce Microsoft SmartScreen warnings.
- The app checks `latest-{{target}}.json` before the shared `latest.json`
  endpoint, so Windows updater metadata can be published as
  `latest-windows.json` without replacing the macOS manifest.

## Local verification

Run the full validation suite before cutting a release:

```bash
npm run check
```

## Windows runtime diagnostics

- The desktop app writes a production runtime log on Windows at Tauri's app log
  directory:

```text
%LOCALAPPDATA%\ch.ogram.private\logs\ogram-private-runtime.log
```

- The same path is displayed in the app footer when the desktop runtime is
  available.
- The log includes app startup, frontend runtime errors, model backend
  selection, cache failures treated as cache misses, folder scan/extract/write
  boundaries, and manifest writes. It does not log source text.
- The Windows model backend uses WASM compatibility mode only. It does not fall
  through to WebGPU after a compatibility failure because affected Windows
  WebView2/GPU combinations can hang or time out there.
- If WASM fails quickly, the app clears the local model cache and retries WASM
  once. It does not start a second retry after a load timeout because the
  original load may still be running inside the model runtime.
- At startup and before execution, the frontend records a performance preflight
  using visible CPU threads, device memory when exposed by WebView2, JavaScript
  heap limit, a small CPU probe, WebGPU availability, platform, and online
  status. Very low memory, heap, CPU probe, or fewer than two visible CPU
  threads produce an in-app performance alert but do not block redaction. Two
  or three visible CPU threads are treated as an advisory because Windows
  WebView2 can under-report that signal.

## Desktop artifacts

- `npm run release:mac:app`
  - Builds the `.app` bundle
  - Signs the updater archive with the local Tauri updater private key
  - Writes `src-tauri/target/release/bundle/updater/latest.json`
- `npm run release:mac:dmg`
  - Builds the downloadable DMG only
  - Notarizes and staples the DMG when Apple notarization credentials are set
- `npm run release:mac:all`
  - Produces both updater and DMG artifacts
  - Notarizes and staples the final DMG when Apple notarization credentials are set
- `npm run release:windows:nsis`
  - Builds the Windows setup `.exe`
  - Signs the updater artifact with the local Tauri updater private key
  - Writes `src-tauri/target/release/bundle/updater/latest-windows.json`
- `npm run release:windows:msi`
  - Builds a Windows `.msi` installer on Windows hosts
  - Uses the MSI artifact as the updater bundle
- `npm run release:windows:all`
  - Produces both NSIS and MSI artifacts on Windows hosts
  - Uses the NSIS artifact for Windows updater metadata unless
    `OGRAM_WINDOWS_UPDATER_BUNDLE=msi` is set

## GitHub Actions release workflow

This repository includes [release-macos.yml](../.github/workflows/release-macos.yml)
for tagged or manual macOS releases.

It also includes [release-windows.yml](../.github/workflows/release-windows.yml)
for tagged or manual Windows releases.

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

The Windows workflow expects this GitHub Actions secret:

- `TAURI_SIGNING_PRIVATE_KEY`

Optional Windows code-signing inputs:

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if your updater key is password-protected
- `WINDOWS_CERTIFICATE` as base64-encoded `.pfx`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_SIGN_COMMAND` for custom signing tools such as Azure Trusted Signing

Optional Windows workflow variables:

- `WINDOWS_DIGEST_ALGORITHM`, defaulting to `sha256`
- `WINDOWS_TIMESTAMP_URL`
- `WINDOWS_TSP`
- `OGRAM_RELEASE_BASE_URL`

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

## Windows signing

The Windows release script always uses the Tauri updater key to generate the
`.exe.sig` or `.msi.sig` updater signature. That is separate from Windows code
signing.

For public Windows downloads, configure either:

- `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` in GitHub Actions, or
- `WINDOWS_SIGN_COMMAND` for a custom signing provider.

When a certificate is imported by the workflow, its thumbprint is passed to
Tauri automatically. For local builds, set `WINDOWS_CERTIFICATE_THUMBPRINT` and
optionally `WINDOWS_TIMESTAMP_URL`.

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
