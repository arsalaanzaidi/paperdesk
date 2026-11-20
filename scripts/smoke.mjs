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
  await page.mouse.click(lb.x + 40, lb.y + 40)

  // No explicit .focus() here: the click above must leave the caret ready to
  // type on its own (one-click-to-type), proving the new box auto-focuses itself.
  const editable = await page.waitForSelector('.text-box-edit', { timeout: 4000 })
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

  // The text toolbar appears above the page when a box is selected and shifts
  // the sheet down, so re-read the layer's position right before every click.
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
  }

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
