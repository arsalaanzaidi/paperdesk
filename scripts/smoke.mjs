// End-to-end smoke test: drives the running dev server with system Chrome,
// uploads a PDF, and verifies the core flow actually renders + mutates.
// Usage: node scripts/smoke.mjs <url> <pdfPath> <screenshotDir>
import puppeteer from 'puppeteer-core'

const URL = process.argv[2] || 'http://localhost:5199/'
const PDF = process.argv[3]
const SHOTS = process.argv[4] || '.'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=1'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text())
  })
  page.on('response', (r) => {
    if (r.status() >= 400) pageErrors.push(`${r.status()} ${r.url()}`)
  })

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.goto(URL, { waitUntil: 'networkidle2' })

  // Empty state shows the dropzone.
  await page.waitForSelector('.dropzone', { timeout: 5000 })
  ok('empty state renders dropzone', true)

  // Upload the PDF via the hidden file input.
  const input = await page.waitForSelector('input[type=file]')
  await input.uploadFile(PDF)

  // Main page canvas should appear and actually contain painted content.
  // Wait for real (non-white) pixels rather than just canvas dimensions:
  // the canvas is resized at the start of renderPage, well before pdf.js
  // paints, so a size-only wait races the paint and can read a blank sheet.
  await page.waitForSelector('.page-sheet canvas', { timeout: 8000 })
  const countNonWhite = () => {
    const c = document.querySelector('.page-sheet canvas')
    if (!c || c.width < 50 || c.height < 50) return { w: 0, h: 0, nonWhite: 0, total: 0 }
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let nonWhite = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) nonWhite++
    }
    return { w: c.width, h: c.height, nonWhite, total: data.length / 4 }
  }
  await page.waitForFunction(
    (fn) => new Function(`return (${fn})()`)().nonWhite > 500,
    { timeout: 8000 },
    countNonWhite.toString(),
  )

  const pixelCheck = await page.evaluate(countNonWhite)
  ok(
    'main page renders real pixels',
    pixelCheck.nonWhite > 500,
    `${pixelCheck.w}x${pixelCheck.h}, ${pixelCheck.nonWhite} non-white px`,
  )
  await page.screenshot({ path: `${SHOTS}/01-loaded-light.png` })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.screenshot({ path: `${SHOTS}/01-loaded-dark.png` })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])

  // Thumbnails: expect 3.
  const thumbCount = await page.$$eval('.thumb', (els) => els.length)
  ok('sidebar shows 3 thumbnails', thumbCount === 3, `got ${thumbCount}`)

  // Page nav → "2 / 3".
  await page.click('button[aria-label="Next page"]')
  await page.waitForFunction(
    () => document.querySelector('.page-controls .readout')?.textContent?.trim().startsWith('2 /'),
    { timeout: 4000 },
  )
  ok('next page advances readout to 2 / 3', true)

  // Add a blank page → 4 thumbnails.
  await page.click('.add-page')
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4, {
    timeout: 6000,
  })
  ok('add blank page → 4 pages', true)
  await page.screenshot({ path: `${SHOTS}/02-added-page.png` })

  // Delete a page → back to 3.
  await page.hover('.thumb')
  await page.click('.thumb .tool.danger')
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 3, {
    timeout: 6000,
  })
  ok('delete page → 3 pages', true)

  // --- Text editing: add a box, type a sentinel, confirm it holds the text ---
  const SENTINEL = 'SmokeSentinel'
  await page.click('[data-testid="tool-text"]')

  // Click near the top-left of the page to spawn a text box.
  const layer = await page.waitForSelector('.text-layer', { timeout: 4000 })
  const lb = await layer.boundingBox()
  const sheetTopBefore = await page.$eval('.page-sheet', (el) => el.getBoundingClientRect().top)
  await page.mouse.click(lb.x + 40, lb.y + 40)

  // No explicit .focus() here: the click above must leave the caret ready to
  // type on its own (one-click-to-type), proving the new box auto-focuses itself.
  const editable = await page.waitForSelector('.text-box-edit', { timeout: 4000 })
  // The text toolbar appears when a box is selected. If it pushed the page down, a touch tap's
  // compatibility mousedown would miss the new box, blur it and delete it.
  const sheetTopAfter = await page.$eval('.page-sheet', (el) => el.getBoundingClientRect().top)
  ok(
    'selecting a new box does not move the page',
    Math.abs(sheetTopAfter - sheetTopBefore) < 0.5,
    `${sheetTopBefore} → ${sheetTopAfter}`,
  )
  await page.keyboard.type(SENTINEL)

  const typed = await page.$eval('.text-box-edit', (el) => el.innerText)
  ok('text box captures typed text', typed.includes(SENTINEL), `got "${typed}"`)
  await page.screenshot({ path: `${SHOTS}/03-text-added.png` })

  // --- Edit existing text: click a known run, replace it, check dedup ---
  const EDIT_SENTINEL = 'EditSentinel'
  const ORIGINAL = 'The quick brown fox'

  // Go to page 1 (every non-blank page of the sample PDF has the sentence).
  while (
    await page.$eval('.page-controls .readout', (el) => !el.textContent.trim().startsWith('1 /'))
  ) {
    await page.click('button[aria-label="Previous page"]')
  }

  await page.click('[data-testid="tool-edit"]')
  await page.waitForSelector('.text-layer[data-text-items]:not([data-text-items="0"])', {
    timeout: 6000,
  })
  ok('edit tool loads text items for the page', true)

  // Re-read the layer's position right before every click, so nothing that moves
  // the sheet (it used to be the text toolbar) can make a click miss.
  const clickRunAt = async (xPt, yPt) => {
    const lb2 = await (await page.$('.text-layer')).boundingBox()
    const zoom = lb2.width / 595.28
    await page.mouse.click(lb2.x + xPt * zoom, lb2.y + yPt * zoom)
  }
  const boxesBefore = await page.$$eval('.text-box', (els) => els.length)
  await clickRunAt(108, 158) // inside the sentence run

  await page.waitForFunction(
    (orig) => [...document.querySelectorAll('.text-box-edit')].some((e) => e.innerText.includes(orig)),
    { timeout: 4000 },
    ORIGINAL,
  )
  ok('edit click spawns a box prefilled with the original run', true)

  // The prefilled run must render as exactly one line: a soft-wrapped last word
  // would sit below the cover, over the page content. Count distinct line tops.
  const lineInfo = await page.$$eval(
    '.text-box-edit',
    (els, orig) => {
      const el = els.find((x) => x.innerText.includes(orig))
      if (!el) return { lines: -1, scrollH: 0, lineH: 0 }
      const range = document.createRange()
      range.selectNodeContents(el)
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
      return { lines: tops.size, scrollH: el.scrollHeight, lineH: parseFloat(getComputedStyle(el).lineHeight) }
    },
    ORIGINAL,
  )
  ok(
    'prefilled edit box renders as a single line',
    lineInfo.lines === 1 && lineInfo.scrollH <= lineInfo.lineH + 1,
    `lines=${lineInfo.lines} scrollHeight=${lineInfo.scrollH} lineHeight=${lineInfo.lineH}`,
  )

  // Require the focused element to be the edit box itself: document.body's
  // innerText also contains the original sentence, so a bare innerText check
  // passes vacuously while nothing is focused yet.
  const autoFocused = await page.waitForFunction(
    (orig) => {
      const a = document.activeElement
      return !!a && a.classList.contains('text-box-edit') && a.innerText.includes(orig)
    },
    { timeout: 2000 },
    ORIGINAL,
  ).then(() => true, () => false)
  ok('edit box is focused without an extra click', autoFocused)

  // The outer .text-box is the run box; its selection frame is an outline, which
  // takes no space. A cover painted only on the inner editor would leave a ring
  // where the original glyph tops show through, so the outer box must paint it.
  const cover = await page.$$eval(
    '.text-box-edit',
    (els, orig) => {
      const edit = els.find((x) => x.innerText.includes(orig))
      const box = edit?.closest('.text-box')
      if (!edit || !box) return null
      const s = getComputedStyle(box)
      return { boxBg: s.backgroundColor, clip: s.backgroundClip, editBg: getComputedStyle(edit).backgroundColor }
    },
    ORIGINAL,
  )
  const TRANSPARENT = 'rgba(0, 0, 0, 0)'
  const coverBg = cover && (cover.boxBg !== TRANSPARENT ? cover.boxBg : cover.editBg)
  ok('edit box carries the sampled cover colour (white page)', coverBg === 'rgb(255, 255, 255)', coverBg)
  ok(
    'cover paints the whole run box',
    !!cover && cover.boxBg === coverBg && cover.clip === 'border-box',
    JSON.stringify(cover),
  )

  // make-test-pdf draws the sentence in rgb(0.15, 0.15, 0.15), i.e. #262626.
  const textColor = await page.$$eval(
    '.text-box-edit',
    (els, orig) => {
      const e = els.find((x) => x.innerText.includes(orig))
      return e ? getComputedStyle(e).color : ''
    },
    ORIGINAL,
  )
  ok("edit box keeps the original run's text colour", textColor === 'rgb(38, 38, 38)', textColor)

  // Bake draws the text with its baseline ASCENT_RATIO (0.8) em below the run box's top and its
  // pen at the box's left edge. CSS puts the baseline at the font's own ascent plus half the
  // leading, so measure where Chrome really renders it, on a hidden clone of the box.
  const place = await page.$$eval(
    '.text-box-edit',
    (els, orig) => {
      const edit = els.find((x) => x.innerText.includes(orig))
      const box = edit?.closest('.text-box')
      if (!box) return null
      const clone = box.cloneNode(true)
      clone.style.visibility = 'hidden'
      box.parentElement.appendChild(clone)
      const cEdit = clone.querySelector('.text-box-edit')
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
      cEdit.appendChild(probe)
      const range = document.createRange()
      range.selectNodeContents(cEdit.firstChild)
      const b = clone.getBoundingClientRect()
      const fontPx = parseFloat(getComputedStyle(cEdit).fontSize)
      const out = {
        dy: +(probe.getBoundingClientRect().top - (b.top + 0.8 * fontPx)).toFixed(2),
        dx: +(range.getClientRects()[0].left - b.left).toFixed(2),
      }
      clone.remove()
      return out
    },
    ORIGINAL,
  )
  ok(
    'edit box text sits on the run baseline and left edge, where bake draws it',
    !!place && Math.abs(place.dy) <= 0.3 && Math.abs(place.dx) <= 0.3,
    JSON.stringify(place),
  )

  // Replace the whole run with the sentinel.
  await page.evaluate(() => document.execCommand('selectAll'))
  await page.keyboard.type(EDIT_SENTINEL)
  const edited = await page.evaluate(() => document.activeElement?.innerText ?? '')
  ok('edit box holds the replacement text', edited === EDIT_SENTINEL, `got "${edited}"`)
  await page.screenshot({ path: `${SHOTS}/04-text-edited.png` })

  // Repeat click on the same spot must select, not stack a duplicate.
  // Deselect first (click blank page area: no hit → selection cleared), so the
  // repeat click has to land on the edited run to reselect it.
  await clickRunAt(300, 500)
  await new Promise((r) => setTimeout(r, 200))
  const deselected = await page.$$eval('.text-box.selected', (els) => els.length === 0)
  ok('blank-area click clears the selection before the repeat click', deselected)
  await clickRunAt(108, 158)
  await new Promise((r) => setTimeout(r, 200))
  const boxesAfter = await page.$$eval('.text-box', (els) => els.length)
  ok('repeat click does not duplicate the edit box', boxesAfter === boxesBefore + 1, `${boxesBefore} → ${boxesAfter}`)
  const selectedText = await page.$eval('.text-box.selected .text-box-edit', (e) => e.innerText).catch(() => '')
  ok('repeat click selects the edited run', selectedText === EDIT_SENTINEL, `got "${selectedText}"`)

  // --- Text the standard 14 fonts can't draw (₹): exported with the bundled fonts ---
  // make-test-pdf embeds "Total due: ₹ 1,234.50" in Arimo on page 1 (baseline 600, so top-left y ≈ 242).
  const RUPEE_RUN = 'Total due: ₹ 1,234.50'
  const PREFILL_SENTINEL = 'PrefillSentinel'
  const boxText = (t) => [...document.querySelectorAll('.text-box-edit')].some((e) => e.innerText.includes(t))
  /** Wait until the box holding `text` is drawn in a font stack that includes `want` (Chrome drops the quotes). */
  const boxFontIs = (text, want) =>
    page
      .waitForFunction(
        (t, w) => {
          const e = [...document.querySelectorAll('.text-box-edit')].find((x) => x.innerText.includes(t))
          return !!e && getComputedStyle(e).fontFamily.replace(/"/g, '').includes(w)
        },
        { timeout: 6000 },
        text,
        want,
      )
      .then(() => true, () => false)

  await clickRunAt(60, 238)
  const rupeePrefilled = await page
    .waitForFunction(
      (t) => document.activeElement?.classList.contains('text-box-edit') && document.activeElement.innerText.includes(t),
      { timeout: 4000 },
      RUPEE_RUN,
    )
    .then(() => true, () => false)
  ok(
    'edit click on an embedded-font run with ₹ prefills a focused box',
    rupeePrefilled,
    JSON.stringify(
      await page.evaluate(() => ({
        boxes: [...document.querySelectorAll('.text-box-edit')].map((e) => e.innerText),
        active: document.activeElement?.className,
        tool: document.querySelector('.text-layer')?.className,
      })),
    ),
  )
  await page.keyboard.type(` ${PREFILL_SENTINEL}`) // the caret is at the end of the run
  ok('the ₹ edit-box shows the bundled face it exports with (Arimo)', await boxFontIs(PREFILL_SENTINEL, 'pd-arimo'))
  ok(
    'edit boxes are not kerned, as pdf-lib draws them',
    await page.$$eval('.text-box-edit', (els) => els.every((e) => getComputedStyle(e).fontKerning === 'none')),
  )

  // A "Calibri" run (make-test-pdf: Carlito glyphs under Calibri's name, baseline 560, so top-left
  // y ≈ 282): its edit-box is drawn in the Carlito look-alike, plain text included, and says so.
  const CALIBRI_RUN = 'Invoice total: 1,234.50'
  const CALIBRI_SENTINEL = 'CalibriSentinel'
  await clickRunAt(60, 278)
  const calibriPrefilled = await page
    .waitForFunction(
      (t) => document.activeElement?.classList.contains('text-box-edit') && document.activeElement.innerText.includes(t),
      { timeout: 4000 },
      CALIBRI_RUN,
    )
    .then(() => true, () => false)
  ok('edit click on a Calibri run prefills a focused box', calibriPrefilled)
  await page.keyboard.type(` ${CALIBRI_SENTINEL}`)
  ok('the Calibri edit-box shows its look-alike, Carlito', await boxFontIs(CALIBRI_SENTINEL, 'pd-carlito'))
  const calibriToolbar = await page.evaluate(() => ({
    font: document.querySelector('select[aria-label="Font family"]')?.value,
    match: document.querySelector('[data-testid="font-match"]')?.textContent,
  }))
  ok(
    'the toolbar shows Carlito standing in for Calibri',
    calibriToolbar.font === 'carlito' && calibriToolbar.match === 'for Calibri',
    JSON.stringify(calibriToolbar),
  )

  // A "Times New Roman" subset run (baseline 520, top-left y ≈ 322): an edit that only reuses its
  // characters is drawn in that very font, in the editor (pdf.js's face for it) and in the export.
  const TIMES_EDIT = 'Ref 2025-04'
  await clickRunAt(60, 318)
  await page.waitForFunction(
    () => document.activeElement?.classList.contains('text-box-edit') && document.activeElement.innerText.includes('Ref 2024-05'),
    { timeout: 4000 },
  ).catch(() => {})
  await page.evaluate(() => document.execCommand('selectAll'))
  await page.keyboard.type(TIMES_EDIT)
  const ownFace = await page
    .waitForFunction(
      (t) => {
        const e = [...document.querySelectorAll('.text-box-edit')].find((x) => x.innerText === t)
        return !!e && /^"?g_d\d+_f\d+/.test(getComputedStyle(e).fontFamily)
      },
      { timeout: 6000 },
      TIMES_EDIT,
    )
    .then(() => true, () => false)
  const timesLabel = await page.$eval('[data-testid="font-match"]', (e) => e.textContent).catch(() => null)
  ok(
    "an edit using only the run's own characters shows the PDF's own font, labelled so",
    ownFace && timesLabel === 'original font',
    JSON.stringify({ ownFace, timesLabel }),
  )

  // A mono box with ₹: Cousine lacks the glyph, so that one character falls back to Arimo.
  await page.click('[data-testid="tool-text"]')
  await clickRunAt(300, 400) // clear of the floating page controls
  const monoFocused = await page
    .waitForFunction(() => document.activeElement?.classList.contains('text-box-edit'), { timeout: 4000 })
    .then(() => true, () => false)
  ok(
    'Add text makes a focused box below the ₹ edit',
    monoFocused,
    JSON.stringify(
      await page.evaluate(() => ({
        boxes: [...document.querySelectorAll('.text-box-edit')].map((e) => e.innerText),
        active: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
        layer: document.querySelector('.text-layer')?.className,
        pressed: document.querySelector('[data-testid="tool-text"]')?.className,
      })),
    ),
  )
  await page.keyboard.type('Mono ₹ 7')
  await page.select('select[aria-label="Font family"]', 'mono')
  ok('a mono box with ₹ shows Cousine, then Arimo', await boxFontIs('Mono ₹ 7', 'pd-cousine, pd-arimo'))

  // A character no bundled font has: export refuses and names it, instead of drawing a blank glyph.
  await clickRunAt(300, 460)
  await page.waitForFunction(() => document.activeElement?.classList.contains('text-box-edit'), { timeout: 4000 })
  await page.keyboard.type('Kanji 漢')
  await page.click('button.primary')
  const refusal = await page
    .waitForFunction(() => document.querySelector('.statusbar')?.textContent.includes('漢 (U+6F22)'), { timeout: 8000 })
    .then(() => true, () => false)
  ok('export refuses a character no bundled font has, and names it', refusal, await page.$eval('.statusbar', (e) => e.textContent))
  // Remove that box so the real export below goes through.
  await clickRunAt(305, 470)
  await page.click('button[aria-label="Delete text box"]')
  ok('the refused box can be deleted', !(await page.evaluate(boxText, 'Kanji')))

  // Export PDF: capture the download.
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: SHOTS,
  })
  // WebKit (Safari, and every browser on iOS) starts a download after the click, so the blob URL
  // must outlive it. Chrome never notices an early revoke, so watch for one directly.
  await page.evaluate(() => {
    window.__revokes = 0
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (u) => {
      window.__revokes++
      revoke(u)
    }
  })
  await page.click('button.primary')
  await new Promise((r) => setTimeout(r, 2000))
  const earlyRevokes = await page.evaluate(() => window.__revokes)
  ok(
    'export keeps the download URL alive after the click (Safari and iOS need it)',
    earlyRevokes === 0,
    `${earlyRevokes} revoked within 2s`,
  )
  const { readdirSync, readFileSync } = await import('node:fs')
  const pdfs = readdirSync(SHOTS).filter((f) => f.toLowerCase().endsWith('.pdf'))
  const exported = pdfs.length > 0
  let validHeader = false
  if (exported) {
    const head = readFileSync(`${SHOTS}/${pdfs[0]}`).subarray(0, 5).toString('latin1')
    validHeader = head === '%PDF-'
  }
  ok('export produced a .pdf file', exported, pdfs.join(', '))
  ok('exported file has a valid PDF header', validHeader)

  if (exported) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(readFileSync(`${SHOTS}/${pdfs[0]}`))
    const out = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise
    let allText = ''
    for (let n = 1; n <= out.numPages; n++) {
      const c = await (await out.getPage(n)).getTextContent()
      allText += c.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n'
    }
    ok('exported PDF text contains the added-text sentinel', allText.includes(SENTINEL))
    ok('exported PDF text contains the edit sentinel', allText.includes(EDIT_SENTINEL))
    ok('exported PDF keeps the prefilled ₹ edit and its new text', allText.includes(`${RUPEE_RUN} ${PREFILL_SENTINEL}`))
    ok('exported PDF has the mono ₹ box', allText.replace(/\s+/g, ' ').includes('Mono ₹ 7'))
    ok('exported PDF keeps the Calibri edit and its new text', allText.includes(`${CALIBRI_RUN} ${CALIBRI_SENTINEL}`))
    // The edit was drawn in Carlito, not the standard Helvetica, although its text is plain WinAnsi.
    const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib')
    const lib = await PDFDocument.load(readFileSync(`${SHOTS}/${pdfs[0]}`))
    const fontNames = []
    for (const [, obj] of lib.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font')) {
        const base = obj.get(PDFName.of('BaseFont'))
        if (base instanceof PDFName) fontNames.push(base.decodeText())
      }
    }
    ok('exported PDF embeds Carlito for the Calibri edit', fontNames.some((n) => /\+?Carlito/.test(n)), fontNames.join(', '))
    ok('exported PDF has the Times New Roman edit', allText.includes(TIMES_EDIT))
    ok(
      "the Times New Roman edit reused the PDF's font, embedding no look-alike (Tinos)",
      !fontNames.some((n) => /Tinos/.test(n)),
      fontNames.join(', '),
    )
  }

  // Phone: an iPhone-sized touch page. The header was one non-wrapping row 671px wide, which
  // widened the whole page and pushed Export PDF off-screen. Measure against clientWidth: on an
  // overflowing page, innerWidth grows to fit the content, so it would hide the bug.
  const phone = await browser.newPage()
  phone.on('pageerror', (e) => pageErrors.push(String(e)))
  phone.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`phone: ${m.text()}`)
  })
  phone.on('response', (r) => {
    if (r.status() >= 400) pageErrors.push(`phone: ${r.status()} ${r.url()}`)
  })
  await phone.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  )
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await phone.goto(URL, { waitUntil: 'networkidle0' })
  // Before a PDF is open there is room for the name: only the document actions crowd it out.
  const landingBrand = await phone.$eval('.brand', (el) => el.innerText.trim())
  ok('phone: the landing screen shows the paperdesk name', landingBrand.includes('paperdesk'), `"${landingBrand}"`)
  await (await phone.waitForSelector('input[type=file]')).uploadFile(PDF)
  await phone.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 8000 })
  // Header actions: on desktop all five are labelled buttons; on phones only Export PDF and a
  // menu button show, and the other four live in the menu. display:none leaves no client rects.
  const visibleActions = () =>
    [...document.querySelectorAll('.header button')]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => b.getAttribute('aria-label') || b.textContent.trim())
  // The page must be centred when it fits and reachable edge to edge when it doesn't: a centring
  // flexbox would push the overflow off the left edge, where scrolling can't reach it.
  const sheetEdges = () => {
    const desk = document.querySelector('.desk')
    const sheet = document.querySelector('.page-sheet')
    const d = desk.getBoundingClientRect()
    desk.scrollLeft = 0
    const left = sheet.getBoundingClientRect().left - d.left - desk.clientLeft
    desk.scrollLeft = desk.scrollWidth
    const right = d.left + desk.clientLeft + desk.clientWidth - sheet.getBoundingClientRect().right
    desk.scrollLeft = 0
    return { left: Math.round(left), right: Math.round(right), sheet: Math.round(sheet.getBoundingClientRect().width), desk: desk.clientWidth }
  }
  const desktopEdges = await page.evaluate(sheetEdges)
  ok(
    'desktop: the page is centred on the desk',
    desktopEdges.left > 0 && Math.abs(desktopEdges.left - desktopEdges.right) <= 1,
    JSON.stringify(desktopEdges),
  )
  const desktopActions = await page.evaluate(visibleActions)
  ok(
    'desktop: all five header actions are visible buttons, with no menu button',
    desktopActions.length === 5 && !desktopActions.includes('More actions'),
    desktopActions.join(', '),
  )
  const exportLabelItems = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.header button')].find((x) => /Export/.test(x.textContent))
    return [...b.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim()).length
  })
  ok('desktop: the Export label is one flex item (normal word spacing)', exportLabelItems === 1, `${exportLabelItems} flex items`)
  const phoneLayout = await phone.evaluate((visibleActionsSrc) => {
    const vw = document.documentElement.clientWidth
    const btn = [...document.querySelectorAll('button')].find((b) => /Export PDF/.test(b.textContent))
    const r = btn.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      screen: vw,
      pageWidth: document.documentElement.scrollWidth,
      exportOnScreen: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= innerHeight,
      exportOnTop: !!top && btn.contains(top),
      actions: new Function(`return (${visibleActionsSrc})()`)(),
    }
  }, visibleActions.toString())
  const phoneEdges = await phone.evaluate(sheetEdges)
  ok(
    'phone: the whole page can be scrolled into view, left edge included',
    phoneEdges.left >= 0 && phoneEdges.right >= 0,
    JSON.stringify(phoneEdges),
  )
  ok(
    'phone: the header shows only Export PDF and the menu button',
    phoneLayout.actions.length === 2 &&
      phoneLayout.actions.includes('More actions') &&
      phoneLayout.actions.some((a) => a.includes('Export')),
    phoneLayout.actions.join(', '),
  )
  ok(
    'phone: page is no wider than the screen',
    phoneLayout.pageWidth <= phoneLayout.screen,
    `${phoneLayout.pageWidth}px page on a ${phoneLayout.screen}px screen`,
  )
  ok(
    'phone: Export PDF is fully on screen and nothing covers it',
    phoneLayout.exportOnScreen && phoneLayout.exportOnTop,
    JSON.stringify(phoneLayout),
  )
  const { mkdirSync } = await import('node:fs')
  const phoneShots = `${SHOTS}/phone`
  mkdirSync(phoneShots, { recursive: true })
  const phoneCdp = await phone.createCDPSession()
  await phoneCdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: phoneShots })
  // A button off-screen makes tap() throw; record that as a failure instead of aborting the run.
  const tapped = await phone.tap('button.primary').then(
    () => true,
    (e) => String(e),
  )
  await new Promise((r) => setTimeout(r, 2000))
  const phonePdfs = readdirSync(phoneShots).filter((f) => f.toLowerCase().endsWith('.pdf'))
  ok(
    'phone: tapping Export PDF downloads the file',
    tapped === true && phonePdfs.length > 0,
    tapped === true ? phonePdfs.join(', ') : tapped,
  )

  // The ☰ menu is a disclosure: plain buttons, aria-expanded on ☰, aria-pressed on the two tools.
  const MENU = 'button[aria-label="More actions"]'
  const menuOpen = () => !!document.querySelector('#header-menu')
  const focusOnMenuButton = () => document.activeElement === document.querySelector('button[aria-label="More actions"]')
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  const onPhonePage = (xPt, yPt) =>
    phone.evaluate((x, y) => {
      const r = document.querySelector('.text-layer').getBoundingClientRect()
      return { x: r.left + x, y: r.top + y }
    }, xPt, yPt)

  const heights = await phone.evaluate(() => {
    const h = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().height)
    return { menu: h('button[aria-label="More actions"]'), exportButton: h('.header .btn.primary') }
  })
  ok('phone: ☰ is as tall as Export', Math.abs(heights.menu - heights.exportButton) <= 1, JSON.stringify(heights))

  await phone.tap(MENU).catch(() => {})
  const menuState = await phone.evaluate(() => ({
    items: [...document.querySelectorAll('#header-menu button')].map((b) => ({
      name: b.textContent.trim(),
      pressed: b.getAttribute('aria-pressed'),
    })),
    expanded: document.querySelector('button[aria-label="More actions"]').getAttribute('aria-expanded'),
    haspopup: document.querySelector('button[aria-label="More actions"]').hasAttribute('aria-haspopup'),
    roleMenu: !!document.querySelector('[role="menu"], [role^="menuitem"]'),
  }))
  ok(
    'phone: the menu lists Open, Add text, Edit text and Save page PNG',
    menuState.items.length === 4 &&
      ['Open another', 'Add text', 'Edit text', 'Save page PNG'].every((n) => menuState.items.some((i) => i.name.includes(n))),
    menuState.items.map((i) => i.name).join(', '),
  )
  // No tool is on yet, so both tools must say aria-pressed="false" (not just carry the attribute).
  ok(
    'phone: the menu is a disclosure (aria-expanded on ☰, aria-pressed on the tools, no role=menu)',
    menuState.expanded === 'true' &&
      !menuState.haspopup &&
      !menuState.roleMenu &&
      menuState.items.filter((i) => i.pressed === 'false').length === 2 &&
      menuState.items.filter((i) => i.pressed !== null).length === 2,
    JSON.stringify(menuState),
  )

  // Add text by touch, with nothing selected and the desk at the top: the first tap used to make
  // a box and delete it straight away.
  await phone.tap('[data-testid="menu-tool-text"]').catch(() => {})
  ok('phone: choosing a menu item returns focus to ☰', await phone.evaluate(focusOnMenuButton))
  const blank = await onPhonePage(300, 300)
  const sheetTop0 = await phone.$eval('.page-sheet', (el) => el.getBoundingClientRect().top)
  await phone.touchscreen.tap(blank.x, blank.y)
  await pause(300)
  await phone.keyboard.type('PhoneSentinel')
  await pause(300)
  const added = await phone.evaluate(() => ({
    boxes: document.querySelectorAll('.text-box').length,
    text: [...document.querySelectorAll('.text-box-edit')].map((e) => e.innerText).join('|'),
    sheetTop: document.querySelector('.page-sheet').getBoundingClientRect().top,
  }))
  ok(
    'phone: tapping the page with Add text keeps the new box and takes typing',
    added.boxes === 1 && added.text.includes('PhoneSentinel'),
    JSON.stringify(added),
  )
  // Only meaningful while the box exists: once it is deleted the toolbar goes and the page moves back.
  ok(
    'phone: selecting a new box does not move the page',
    added.boxes === 1 && Math.abs(added.sheetTop - sheetTop0) < 0.5,
    `${sheetTop0} → ${added.sheetTop}, ${added.boxes} boxes`,
  )

  // A tap on a text box (its handlers stop propagation) must still close the menu. Blur ☰ first,
  // as Safari never focuses a tapped button: in Chrome, focus moving from ☰ to the box would close
  // the menu through focusout even if the tap went through to the box.
  await phone.tap(MENU).catch(() => {})
  await phone.evaluate(() => document.activeElement?.blur())
  const boxPt = await phone.$eval('.text-box', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }).catch(() => null)
  if (boxPt) await phone.touchscreen.tap(boxPt.x, boxPt.y)
  await pause(200)
  ok('phone: tapping a text box closes the open menu', !!boxPt && !(await phone.evaluate(menuOpen)))

  await phone.tap(MENU).catch(() => {})
  await phone.tap('[data-testid="menu-tool-edit"]').catch(() => {})
  const afterEdit = await phone.evaluate(
    (menuOpenSrc, focusSrc) => ({
      menuOpen: new Function(`return (${menuOpenSrc})()`)(),
      editing: !!document.querySelector('.text-layer.editing'),
      menuButtonActive: !!document.querySelector('button[aria-label="More actions"].active'),
      focusOnMenuButton: new Function(`return (${focusSrc})()`)(),
    }),
    menuOpen.toString(),
    focusOnMenuButton.toString(),
  )
  ok(
    'phone: choosing Edit text turns the tool on, closes the menu and marks the menu button',
    afterEdit.editing && !afterEdit.menuOpen && afterEdit.menuButtonActive && afterEdit.focusOnMenuButton,
    JSON.stringify(afterEdit),
  )

  // A tap that only closes the menu must not also reach the page (it used to spawn an edit-box).
  await pause(600) // the edit tool loads the page's text runs
  await phone.tap(MENU).catch(() => {})
  const pressedNow = await phone.evaluate(() => ({
    text: document.querySelector('[data-testid="menu-tool-text"]')?.getAttribute('aria-pressed'),
    edit: document.querySelector('[data-testid="menu-tool-edit"]')?.getAttribute('aria-pressed'),
  }))
  ok(
    'phone: with Edit text on, the menu marks it pressed and Add text not',
    pressedNow.edit === 'true' && pressedNow.text === 'false',
    JSON.stringify(pressedNow),
  )
  const runPt = await onPhonePage(108, 158)
  const phoneBoxesBefore = await phone.$$eval('.text-box', (els) => els.length)
  await phone.touchscreen.tap(runPt.x, runPt.y)
  await pause(300)
  const afterDismiss = await phone.evaluate(
    (menuOpenSrc) => ({ menuOpen: new Function(`return (${menuOpenSrc})()`)(), boxes: document.querySelectorAll('.text-box').length }),
    menuOpen.toString(),
  )
  ok(
    "phone: a tap that closes the menu doesn't also act on the page",
    !afterDismiss.menuOpen && afterDismiss.boxes === phoneBoxesBefore,
    `${phoneBoxesBefore} → ${afterDismiss.boxes} boxes, menuOpen=${afterDismiss.menuOpen}`,
  )

  // Keyboard: Tab past the last item closes the menu; Escape closes it and returns focus to ☰.
  await phone.tap(MENU).catch(() => {})
  await phone.focus(MENU)
  for (let i = 0; i < 6; i++) await phone.keyboard.press('Tab')
  ok('phone: tabbing out of the menu closes it', !(await phone.evaluate(menuOpen)))
  // Tab onto an item first: Chrome focuses a tapped ☰, so focus would already be there, and the
  // check has to prove Escape moves focus off the item it unmounts.
  await phone.tap(MENU).catch(() => {})
  await phone.keyboard.press('Tab')
  const focusOnItem = await phone.evaluate(() => !!document.activeElement?.classList.contains('menu-item'))
  await phone.keyboard.press('Escape')
  const afterEscape = await phone.evaluate(
    (menuOpenSrc, focusSrc) => ({
      menuOpen: new Function(`return (${menuOpenSrc})()`)(),
      focusOnMenuButton: new Function(`return (${focusSrc})()`)(),
    }),
    menuOpen.toString(),
    focusOnMenuButton.toString(),
  )
  ok(
    'phone: Escape closes the menu and returns focus to ☰',
    focusOnItem && !afterEscape.menuOpen && afterEscape.focusOnMenuButton,
    JSON.stringify({ focusOnItem, ...afterEscape }),
  )

  // Turning the phone (or widening the window) past the 720px breakpoint hides the open menu. It
  // must close then, rather than pop back open over the page when the screen narrows again.
  const frames = () => phone.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await phone.tap(MENU).catch(() => {})
  const openBeforeTurn = await phone.evaluate(menuOpen)
  await phone.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await frames()
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await frames()
  ok(
    'phone: turning past the 720px breakpoint closes the open menu',
    openBeforeTurn && !(await phone.evaluate(menuOpen)),
    `open before turning: ${openBeforeTurn}`,
  )

  // A long file name with no spaces used to widen the page past the screen: the status bar's
  // "Loaded <name>" can't wrap, and the grid column grew to fit it. Wait for that status, not the
  // file chip: the chip shows the new name before the file has loaded, while the status still says
  // "Loading…", and a check made then passes without the fix.
  const { copyFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const longPdf = `${tmpdir()}/Quarterly_Financial_Report_FY2026_Final_Version_Signed.pdf`
  copyFileSync(PDF, longPdf)
  await (await phone.$('input[type=file]')).uploadFile(longPdf)
  const longLoaded = await phone
    .waitForFunction(() => document.querySelector('.statusbar')?.textContent.includes('Loaded Quarterly_'), { timeout: 8000 })
    .then(() => true, () => false)
  const longName = await phone.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const on = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return r.left >= 0 && r.right <= vw
    }
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.filechip .mono'))
    return {
      screen: vw,
      pageWidth: document.documentElement.scrollWidth,
      exportOnScreen: on('.header .btn.primary'),
      menuOnScreen: on('button[aria-label="More actions"]'),
      sizeLines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
      exportH: Math.round(document.querySelector('.header .btn.primary').getBoundingClientRect().height),
      menuH: Math.round(document.querySelector('button[aria-label="More actions"]').getBoundingClientRect().height),
      dotW: document.querySelector('.statusbar .dot').getBoundingClientRect().width,
    }
  })
  ok(
    'phone: a long file name without spaces still fits the screen',
    longLoaded && longName.pageWidth <= longName.screen && longName.exportOnScreen && longName.menuOnScreen,
    JSON.stringify({ loaded: longLoaded, ...longName }),
  )
  // The file chip squeezes the name, which ellipsizes, and not the size next to it.
  ok('phone: with a long file name the file size stays on one line', longName.sizeLines === 1, `${longName.sizeLines} lines`)
  // Squeezed, Export wraps to two lines (48px tall) and the status dot narrows.
  ok(
    'phone: with a long file name Export, ☰ and the status dot keep their size',
    longName.exportH === heights.exportButton && longName.menuH === heights.menu && longName.dotW === 6,
    JSON.stringify({ exportH: longName.exportH, menuH: longName.menuH, dotW: longName.dotW, short: heights }),
  )
  await phone.screenshot({ path: `${SHOTS}/06-phone.png` })
  await phone.close()

  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exitCode = failed.length ? 1 : 0
} catch (e) {
  console.error('SMOKE ERROR:', e)
  process.exitCode = 1
} finally {
  await browser.close()
}
