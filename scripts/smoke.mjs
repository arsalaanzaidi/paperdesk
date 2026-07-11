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

  const editable = await page.waitForSelector('.text-box-edit', { timeout: 4000 })
  await editable.focus()
  await page.keyboard.type(SENTINEL)

  const typed = await page.$eval('.text-box-edit', (el) => el.innerText)
  ok('text box captures typed text', typed.includes(SENTINEL), `got "${typed}"`)
  await page.screenshot({ path: `${SHOTS}/03-text-added.png` })

  // Export PDF: capture the download.
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: SHOTS,
  })
  await page.click('button.primary')
  await new Promise((r) => setTimeout(r, 2000))
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
