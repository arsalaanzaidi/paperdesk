# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**paperdesk** — a client-side PDF page editor (React 19 + TypeScript + Vite). Everything runs in the browser: no server, no upload. A dropped/selected PDF is held as `Uint8Array` bytes in app state; edits round-trip through `pdf-lib` (mutate bytes → new bytes), while `pdfjs-dist` handles read-only rendering to `<canvas>`.

## Commands

```bash
yarn install
yarn dev              # Vite dev server
yarn build             # tsc -b (project references) && vite build
yarn lint              # eslint .
yarn preview           # preview production build
```

There is no unit test runner configured (no `test` script, no test framework dependency). The only test is an end-to-end smoke script that drives a running dev server with real Chrome:

```bash
node scripts/make-test-pdf.mjs /tmp/test.pdf     # generate a 3-page sample PDF
yarn dev                                          # in one terminal
node scripts/smoke.mjs http://localhost:5199/ /tmp/test.pdf /tmp/shots   # in another
```

`scripts/smoke.mjs` uses `puppeteer-core` against the system Chrome install (hardcoded path `/Applications/Google Chrome.app/...`, i.e. macOS-only as written). It exercises the full flow — load, render (asserts real non-white pixels, not just canvas size), navigate pages, add/delete a page, export — and exits non-zero on any failed check.

## Architecture

### Data flow: bytes in, bytes out

The single source of truth is `bytes: Uint8Array` in the zustand store (`src/store/usePdfStore.ts`). Every mutation (`insertBlankPage`, `deletePage`, `movePage` in `src/lib/pdf.ts`) takes bytes in, loads them with `pdf-lib`'s `PDFDocument`, mutates, and returns new bytes via `.save()` — it never mutates the live pdf.js doc in place. After a mutation, the store calls `applyBytes()`, which re-opens the new bytes with pdf.js (`openForRender`) to get a fresh `PDFDocumentProxy` for rendering, destroys the previous proxy, and bumps `docVersion`.

This means every edit reloads and re-renders the whole document from scratch — simple and correct, but not incremental. `docVersion` exists purely so page/thumbnail components know a re-render is needed even when `currentPage`/`pageNumber` haven't changed (the `doc` object reference alone isn't a reliable enough dependency for effects).

Two libraries, two jobs — don't cross them:
- **pdf-lib** (`PDFDocument`) — the only thing that mutates page structure (insert/delete/reorder) and produces the exported bytes.
- **pdfjs-dist** (`PDFDocumentProxy`) — read-only rendering to canvas (`renderPage`, `renderPageToBlob` in `src/lib/pdf.ts`). Its worker is wired up via `PdfWorker` imported with Vite's `?url` suffix (`pdfjs-dist/build/pdf.worker.min.mjs?url`) and set as `pdfjsLib.GlobalWorkerOptions.workerSrc` — this must stay un-inlined by Vite (see comment in `vite.config.ts`).

`openForRender` calls `bytes.slice()` before handing data to pdf.js, because pdf.js can detach/neuter the underlying `ArrayBuffer` — callers that need to keep `bytes` around must not hand over the original.

### Store shape (`src/store/usePdfStore.ts`)

All async mutation actions (`loadFile`, `addBlankPage`, `removePage`, `reorderPage`) follow the same pattern: set `busy` + `status`, do the work, set `status` or `error` on completion, clear `busy` in `finally`. `error` and `status` are separate fields — `StatusBar` shows `error ?? status`, and `Toast` transiently pops up `error` for 4s then clears it (only if it hasn't since changed).

Page indices: the store's public API is 1-based (`oneBased` params), matching how humans think about pages; `src/lib/pdf.ts` mutation functions are 0-based (`index`), matching pdf-lib's API. The conversion happens at the store boundary — keep it that way rather than mixing conventions in one layer.

### Components (`src/components/`)

`App.tsx` swaps between `UploadZone` (no doc loaded) and `Sidebar` + `Desk` (doc loaded), plus an always-present `Header`/`StatusBar`/`Toast`. Sidebar thumbnails and the Desk's main canvas each run their own render effect keyed on `[doc, docVersion, pageNumber/currentPage]` — there's no shared render cache between them.

Reordering (`Sidebar.tsx`) is native HTML drag-and-drop tracking `dragFrom` (page being dragged) and `dropAt` (`{ index, where: 'before' | 'after' }`); `handleDrop` converts that into a destination 1-based index, adjusting for the source page vacating its slot (`if (dragFrom < to) to -= 1`) before calling `reorderPage`.

### Git Workflow

All git operations must use the GitHub CLI (`gh`). This project enforces `gh` for commits, pushing, pulling, and PR work:

- **Commits:** Use `gh pr create --title "..." --body "..."` or manage via GitHub web interface
- **Pushing:** Use `gh pr create` to create PRs, or `gh pr view` / `gh pr list` for status
- **Pulling:** Use `gh repo sync` to sync forks, or `gh pr merge` to merge PRs
- **Cloning:** Use `gh repo clone owner/repo`

The .claude/settings.local.json enforces these via PreToolUse hooks — direct `git` commands will be blocked with guidance to use `gh` instead.

## Constraints worth knowing

- `MAX_BYTES` (50MB) in the store is a soft warning threshold, not a hard limit — large files still load, just with a status message.
- `removePage` refuses to delete the last remaining page (checked both in the store and in `deletePage` itself).
- `.yarnrc` forces `--ignore-engines true` because `pdfjs-dist` declares `node>=20` in its engines field even though it's a browser library — this is safe to ignore since Vite/esbuild handles it fine under Node 18.
- All git operations in this project use the `gh` CLI (GitHub CLI) — raw `git` commands are blocked by hooks in favor of gh-based workflows.
