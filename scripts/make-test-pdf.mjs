// Generates a 3-page A4 test PDF with distinct text on each page.
// Usage: node scripts/make-test-pdf.mjs <outPath>
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as fontkit from 'fontkit'
import { readFile, writeFile } from 'node:fs/promises'

const out = process.argv[2] || 'test.pdf'
const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.HelveticaBold)
const body = await doc.embedFont(StandardFonts.Helvetica)
// A run in an embedded font with a character the standard 14 can't draw, like a real-world PDF.
// Embedded whole (subset: false), so this script needs none of the app's fontkit adapter.
doc.registerFontkit(fontkit)
const arimo = await doc.embedFont(await readFile(new URL('../src/assets/fonts/Arimo-Regular.ttf', import.meta.url)))
// A "Calibri" run, as a Word export would have: Carlito's glyphs under Calibri's name, so the editor
// has to match it to its look-alike by name.
const calibri = await doc.embedFont(await readFile(new URL('../src/assets/fonts/Carlito-Regular.ttf', import.meta.url)), {
  customName: 'Calibri',
})

const pages = [
  { title: 'Quarterly Report', color: rgb(0.23, 0.29, 0.88) },
  { title: 'Findings', color: rgb(0.1, 0.55, 0.35) },
  { title: 'Appendix', color: rgb(0.75, 0.22, 0.17) },
]

pages.forEach((p, i) => {
  const page = doc.addPage([595.28, 841.89])
  page.drawRectangle({ x: 0, y: 780, width: 595.28, height: 62, color: p.color })
  page.drawText(p.title, { x: 48, y: 800, size: 26, font, color: rgb(1, 1, 1) })
  page.drawText(`Page ${i + 1} of ${pages.length}`, {
    x: 48,
    y: 720,
    size: 14,
    font: body,
    color: rgb(0.2, 0.2, 0.2),
  })
  page.drawText('The quick brown fox jumps over the lazy dog.', {
    x: 48,
    y: 680,
    size: 12,
    font: body,
    color: rgb(0.15, 0.15, 0.15),
  })
  // On every page, like the sentence: the smoke test deletes a page before it edits text.
  page.drawText('Total due: ₹ 1,234.50', { x: 48, y: 600, size: 12, font: arimo, color: rgb(0.15, 0.15, 0.15) })
  page.drawText('Invoice total: 1,234.50', { x: 48, y: 560, size: 12, font: calibri, color: rgb(0.15, 0.15, 0.15) })
})

await writeFile(out, await doc.save())
console.log(`wrote ${out}`)
