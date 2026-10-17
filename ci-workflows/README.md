# Workflows waiting to be installed

These two files belong in `.github/workflows/`. The build agent's GitHub access can't create
workflow files, so they are kept here until William adds them (copy both files into
`.github/workflows/` on the `claude/project-thread-paqhll` branch, or on main). Once they are in
place this folder can be deleted.

- `ci.yml` runs typecheck, lint, unit tests and Playwright e2e on Ubuntu, and builds the Windows
  installer on every push.
- `release.yml` runs on `v*` tags, builds the installer and attaches it to a GitHub Release.
