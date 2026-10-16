# Progress

**Current item:** S3 GitHub Actions
**Last finished:** S2 fixture generator
**Next up:** Tier 1 from T1.1

## How to install
Download `Drawset-Setup-<version>.exe` from the latest GitHub Release (https://github.com/wmckenziegp/drawset/releases) and run it. Windows SmartScreen may warn because the installer is not code-signed: choose "More info" then "Run anyway".

## Known issues
- None yet.

## Log
- S1: Saved SPEC.md unchanged; wrote CLAUDE.md, PLAN.md, DECISIONS.md and this file.
- S2: `npm run fixtures` writes six PDFs (dense A1 with 20,000 paths, 1:100 calibration sheet with calibration.json, 200-page labelled set with 10 planted terms, scanned page, annotated PDF with vendor private keys and a review-state reply, form PDF). `tests/unit/fixtures.test.ts` checks them in MuPDF and pdf.js. BIG=1 makes a ~100 MB set.
