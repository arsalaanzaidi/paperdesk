# Edit text: keep the original run's colour

**Problem.** A new edit-box's text colour is `contrastText(coverColor)`: near-black `#111111` or white. It never reads the original run, so grey text (for example `#575757` in a sample itinerary) comes back black.

**Approach.** Read the colour from pdf.js's operator list, which `extractTextItems` already loads for font names. pdf.js converts grey, CMYK and other colour spaces to `setFillRGBColor` with 0-255 channels there, so the value is exact.

1. Walk the ops and track the fill colour, starting at black.
   - `save`/`restore` push and pop the fill colour and the text rendering mode.
   - A pattern fill (`setFillColorN`) makes the colour unknown.
   - Invisible text (rendering mode 3 or 7) has no colour.
2. Turn each `showText` glyph into a character tagged with its colour, then line the characters up with the text items in order. Before comparing, apply NFKC (pdf.js normalises ligatures) and drop whitespace (pdf.js inserts spaces). An item takes the most common colour among its characters. It gets no colour if it can't be matched.
3. `PageTextItem.color?: string` carries the colour. `TextLayer` uses `hit.color ?? contrastText(coverColor)`, which is today's behaviour as the fallback.

## Steps (TDD)

1. Unit tests for `runColors` with synthetic op lists:
   - two colours;
   - `save`/`restore`;
   - an item that spans two `showText` ops;
   - a ligature;
   - invisible text;
   - a pattern fill;
   - an unmatched item.
2. Round-trip test: a pdf-lib page with grey text and black text, read back by `extractTextItems`, carries `#575757` and `#000000`.
3. Smoke check: the edit-box text colour equals the original run's colour. The fixture sentence is `rgb(0.15, 0.15, 0.15)`, which is `#262626`.
4. Wire it up, then run `yarn test`, `yarn build`, `yarn lint` and the smoke test, and re-check the itinerary's Total row in the pane.
