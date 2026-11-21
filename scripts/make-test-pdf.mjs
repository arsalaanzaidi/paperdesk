// Generates a 3-page A4 test PDF with distinct text on each page.
// Usage: node scripts/make-test-pdf.mjs <outPath>
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as fontkit from 'fontkit'
import { readFile, writeFile } from 'node:fs/promises'

const out = process.argv[2] || 'test.pdf'
const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.HelveticaBold)
const body = await doc.embedFont(StandardFonts.Helvetica)
// Runs in embedded fonts, as real-world PDFs have them: subsets (only the glyphs drawn) under
// subset-tagged names. fontkit 2 needs the app's encodeStream adapter (src/lib/fontkit.ts) to subset.
doc.registerFontkit({
  create(bytes) {
    const f = fontkit.create(bytes)
    const createSubset = f.createSubset.bind(f)
    f.createSubset = () => {
      const subset = createSubset()
      subset.encodeStream = () => {
        const on = {}
        const stream = { on: (event, fn) => ((on[event] = fn), stream) }
        setTimeout(() => (on.data?.(subset.encode()), on.end?.()), 0)
        return stream
      }
      return subset
    }
    return f
  },
})
const embed = async (file, customName) =>
  doc.embedFont(await readFile(new URL(`../src/assets/fonts/${file}`, import.meta.url)), { subset: true, customName })
// A character the standard 14 can't draw.
const arimo = await embed('Arimo-Regular.ttf', 'GHIJKL+Arimo-Regular')
// "Calibri", as a Word export would have it: the editor has to match it to its look-alike by name.
const calibri = await embed('Carlito-Regular.ttf', 'MNOPQR+Calibri')
// "Times New Roman": an edit that only reuses these characters stays in this very font.
const times = await embed('Tinos-Regular.ttf', 'STUVWX+TimesNewRomanPSMT')

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
  page.drawText('Ref 2024-05', { x: 48, y: 520, size: 12, font: times, color: rgb(0.15, 0.15, 0.15) })
})

await writeFile(out, await doc.save())
console.log(`wrote ${out}`)
