export interface TextRun {
  text: string
  /** Index into the font chain the run was split for. */
  font: number
}

const hex = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

/** Text holds characters that no font in the chain can draw. */
export class UncoveredCharactersError extends Error {
  constructor(readonly chars: string[]) {
    const list = chars.map((c) => `${c} (${[...c].map(hex).join(' ')})`).join(', ')
    super(`No font here can draw ${list}. Remove ${chars.length > 1 ? 'them' : 'it'} and export again.`)
  }
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

/**
 * Split text into runs, each drawn with the first font in `covers` that has every code point of
 * its graphemes. Throws UncoveredCharactersError instead of drawing a .notdef glyph.
 */
export function splitRuns(text: string, covers: ((codePoint: number) => boolean)[]): TextRun[] {
  const runs: TextRun[] = []
  const missing: string[] = []
  for (const { segment } of graphemes.segment(text.normalize('NFC'))) {
    const codePoints = [...segment].map((c) => c.codePointAt(0)!)
    const font = covers.findIndex((has) => codePoints.every(has))
    if (font < 0) {
      if (!missing.includes(segment)) missing.push(segment)
      continue
    }
    const last = runs[runs.length - 1]
    if (last?.font === font) last.text += segment
    else runs.push({ text: segment, font })
  }
  if (missing.length) throw new UncoveredCharactersError(missing)
  return runs
}
