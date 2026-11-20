# Cover colour sampling: dominant colour over a region

**Problem.** `coverSamplePoint` reads one pixel 3 CSS px left of a run. When pdf.js splits a line into several runs, that pixel can land on the previous glyph, so the cover comes out grey or black on a white page.

**Approach.** Most pixels inside a text run's box are background, not ink. Sample a grid over exactly the run's box. Cluster the colours by tolerance (±24 per channel from each cluster's first colour) and return the most common exact colour in the largest cluster. A mean drifts towards anti-aliased edge pixels: smoke caught `#FEFEFE` on a white page. Treat fully transparent pixels as white. Use one `getImageData` call per click.

## Steps (TDD)

1. `coverSampleRegion(rect, zoom, pxPerCss, canvasW, canvasH)`: device-px `{x, y, w, h}` for the run box plus margin, clamped to the canvas. Returns `null` for an empty canvas or an empty region. Replaces `coverSamplePoint`.
2. `dominantColor({data, width, height})`: grid-sample (at most about 32×32 points), bucket, and return the mean hex of the winning bucket. Transparent counts as white. Empty input gives white.
3. `sampleCoverColor(ctx, region)`: `getImageData` + `dominantColor`, with white if the read throws. Replaces `sampleColorAt`.
4. Regression test: a white region with a black "previous glyph" in the left margin and about 25% ink inside the run must return white.
5. Wire into `TextLayer.sampleCover`. Remove the dead single-point helpers. Update CLAUDE.md's known-limits line.
6. `yarn test`, `yarn build`, `yarn lint`, smoke.

## Review follow-up

An independent review found the 3px margin let page outside a tight band (zebra table rows, badges) outvote the band at zoom 0.5. It also found that fixed 4-bit buckets split noisy backgrounds (127/128, 239/240) so ink could win. The fix drops the margin and replaces the buckets with tolerance clusters.
