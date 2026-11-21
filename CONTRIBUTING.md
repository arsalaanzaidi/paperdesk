# Contributing to paperdesk

Contributions are welcome: bug reports, fixes and features. Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It explains how the editor and the export stay in step, which most changes touch.

## Licence of contributions

paperdesk is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): free for noncommercial use, commercial use only with permission. By opening a pull request, you agree that your contribution is licensed under the same terms.

## Reporting bugs

Open an issue with:
- the steps to reproduce;
- what you expected and what happened;
- the browser and device.

**Don't attach PDFs that hold personal or confidential data.** Reproduce the bug with a small PDF you made, for example from `node scripts/make-test-pdf.mjs sample.pdf`, or describe the PDF's fonts and structure instead.

## Setup

- **Node 18 or newer.** `.yarnrc` ignores pdfjs-dist's `node>=20` engine field, which only gates tooling.
- **Yarn 1.22.22**, as pinned in `package.json` (`corepack enable` picks it up).

```bash
yarn install
yarn dev     # Vite dev server
```

## Checks

Every pull request runs these on GitHub Actions; run them before you push:

```bash
yarn lint
yarn test    # vitest unit tests (node environment)
yarn build   # type-check and production build
```

For UI changes, also run the smoke test, which drives a real Chrome against the dev server:

```bash
node scripts/make-test-pdf.mjs /tmp/test.pdf
yarn dev --port 5199
node scripts/smoke.mjs http://localhost:5199/ /tmp/test.pdf /tmp/shots
```

`/tmp/shots` must be empty before each run. The script expects Chrome at the macOS path in `scripts/smoke.mjs`; on other systems, change `CHROME` there locally.

## Making a change

- **Branch:** work on a branch in your fork, and open a pull request against `master`. Keep each pull request to one change.
- **Tests:**
  - Write a failing test first, then the fix.
  - Library code (`src/lib`) gets unit tests.
  - UI behaviour gets a smoke check that fails without the change.
  - Don't write checks that can pass vacuously: wait for the state you measure, and assert what the check's name says.
- **Editor/export parity:** anything that changes how text looks in the editor must change the export the same way, and the other way round (see ARCHITECTURE.md §6).
- **Privacy:** paperdesk never sends a document anywhere. Don't add network requests, analytics or third-party CDNs.
- **Fonts:** bundle only fonts under the SIL Open Font License (or equally free terms).
  - Add their licence text to `public/licenses`.
  - `src/lib/fonts.test.ts` runs build checks on every bundled face: it is embeddable, it subsets safely, and ₹ is reachable through its chain.
- **Commits:** a short subject with a type prefix, such as `fix: …`, `feat: …`, `test: …`, `docs: …`, `build: …` or `ci: …`, saying what changed for the user.

## Releases

Merging to `master` deploys the site automatically, so only maintainers merge.
