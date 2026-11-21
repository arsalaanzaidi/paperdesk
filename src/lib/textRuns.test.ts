import { describe, it, expect } from 'vitest'
import { splitRuns, UncoveredCharactersError } from './textRuns'

const latin = (cp: number) => cp < 0x250 // stands in for a font without ₹
const all = () => true

describe('splitRuns', () => {
  it('keeps text in the first font that has it', () => {
    expect(splitRuns('Total 500', [latin, all])).toEqual([{ text: 'Total 500', font: 0 }])
  })

  it('sends only the characters the first font lacks to the next one, merging neighbours', () => {
    expect(splitRuns('Mono ₹ 7', [latin, all])).toEqual([
      { text: 'Mono ', font: 0 },
      { text: '₹', font: 1 },
      { text: ' 7', font: 0 },
    ])
  })

  it('composes decomposed accents before looking them up', () => {
    expect(splitRuns('café', [latin])).toEqual([{ text: 'café', font: 0 }])
  })

  it('refuses characters no font has, naming each one once', () => {
    const run = () => splitRuns('漢 ok 字 漢', [latin])
    expect(run).toThrow(UncoveredCharactersError)
    expect(run).toThrow('漢 (U+6F22), 字 (U+5B57)')
  })
})
