// The parts of fontkit 2 that paperdesk uses (the package ships no types).
declare module 'fontkit' {
  export interface FontkitSubset {
    includeGlyph(glyph: number | { id: number }): number
    encode(): Uint8Array
  }

  export interface FontkitFont {
    createSubset(): FontkitSubset
    hasGlyphForCodePoint(codePoint: number): boolean
    characterSet: number[]
    head: { indexToLocFormat: number }
    loca: { offsets: number[] }
    'OS/2': { fsType: { noEmbedding: boolean; viewOnly: boolean; editable: boolean } }
  }

  export function create(buffer: Uint8Array, postscriptName?: string): FontkitFont
}
