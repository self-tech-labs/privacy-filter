# Contributing

Thanks for contributing to Privacy Filter by ogram.

## Before you start

- Read [README.md](README.md), [docs/PRIVACY.md](docs/PRIVACY.md), and [DISCLAIMER.md](DISCLAIMER.md).
- Keep the product intentionally narrow: local text or folder-to-Markdown redaction before downstream AI use.
- Do not expand scope with document-management or cloud-sync behavior unless there is an explicit design decision to do so.

## Local setup

```bash
npm install
npm run tauri:dev
```

## Validation

Run the full local check before opening a pull request:

```bash
npm run check
```

If you are touching only one surface, the focused commands are:

```bash
npm test
npm run build
npm run site:check
cargo +1.88.0 check --manifest-path src-tauri/Cargo.toml
```

## Contribution guidelines

- Keep user-facing copy aligned with `src/content/projectContent.ts`.
- Prefer small pull requests with one clear behavioral change.
- Add or update tests when UI or transformation behavior changes.
- Keep legal/disclaimer language visible and consistent across the app, docs, and site.
- Preserve the current low-level bundle identifiers unless a maintainer explicitly decides to migrate them.

## Pull requests

- Describe the user-facing change and the risk it addresses.
- Include screenshots for visible UI or landing-page changes.
- Call out any privacy-model or network-behavior changes explicitly.

## Code style

- TypeScript and Rust changes should stay simple and explicit.
- Remove dead code instead of leaving alternate unused flows in the tree.
- Prefer focused docs updates alongside code changes when behavior changes.
