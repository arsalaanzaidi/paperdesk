// PDFs for unit tests (imported only by *.test.ts; reads font files from disk, so not for the app).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { create } from 'fontkit'
import { adaptFontkit } from './fontkit'
import { faceUrl } from './fonts'

/** A PDF whose page 1 shows `text` in a subset of Arimo named like a real subset ("ABCDEF+Arimo"). */
export async function subsetPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(adaptFontkit({ create }))
  const arimo = new Uint8Array(readFileSync(fileURLToPath(faceUrl('arimo-regular'))))
  const font = await doc.embedFont(arimo, { subset: true, customName: 'ABCDEF+Arimo' })
  doc.addPage([600, 800]).drawText(text, { x: 50, y: 700, size: 20, font })
  return doc.save()
}
