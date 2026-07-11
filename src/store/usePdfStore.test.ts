import { describe, it, expect, beforeEach } from 'vitest'
import { usePdfStore } from './usePdfStore'
import { _resetIdCounter, type TextBox } from '../lib/overlay'

const base: Omit<TextBox, 'id'> = {
  page: 0, xPt: 10, yPt: 10, wPt: 100, hPt: 30,
  text: 'hi', family: 'sans', sizePt: 16, color: '#111111', bold: false, italic: false,
}

beforeEach(() => {
  _resetIdCounter()
  usePdfStore.setState({ overlays: [], selectedBoxId: null, tool: 'select' })
})

describe('overlay actions', () => {
  it('addTextBox assigns an id, appends, and selects it', () => {
    usePdfStore.getState().addTextBox(base)
    const s = usePdfStore.getState()
    expect(s.overlays).toHaveLength(1)
    expect(s.overlays[0].id).toBe('tb_1')
    expect(s.selectedBoxId).toBe('tb_1')
  })

  it('updateTextBox shallow-merges a patch', () => {
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().updateTextBox('tb_1', { text: 'bye', bold: true })
    const box = usePdfStore.getState().overlays[0]
    expect(box.text).toBe('bye')
    expect(box.bold).toBe(true)
    expect(box.family).toBe('sans') // untouched
  })

  it('removeTextBox drops the box and clears selection if it was selected', () => {
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().removeTextBox('tb_1')
    expect(usePdfStore.getState().overlays).toHaveLength(0)
    expect(usePdfStore.getState().selectedBoxId).toBeNull()
  })

  it('setTool toggles the active tool', () => {
    usePdfStore.getState().setTool('text')
    expect(usePdfStore.getState().tool).toBe('text')
  })

  it('setCurrentPage clears the current selection', () => {
    usePdfStore.setState({ numPages: 3 })
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().setCurrentPage(2)
    expect(usePdfStore.getState().selectedBoxId).toBeNull()
  })
})
