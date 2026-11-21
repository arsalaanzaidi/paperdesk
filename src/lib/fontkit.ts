import type { PDFDocument } from 'pdf-lib'
import type { FontkitFont } from 'fontkit'
import { FontsUnavailableError } from './fonts'

/** pdf-lib's fontkit interface, which it doesn't export by name. */
type Fontkit = Parameters<PDFDocument['registerFontkit']>[0]

type Handler = (arg?: unknown) => void

/** A one-shot stand-in for the Node-style stream pdf-lib reads the subset from. */
function streamOf(encode: () => Uint8Array) {
  const handlers: Record<string, Handler> = {}
  const stream = {
    on(event: string, fn: Handler) {
      handlers[event] = fn
      return stream
    },
  }
  setTimeout(() => {
    try {
      handlers.data?.(encode())
      handlers.end?.()
    } catch (e) {
      handlers.error?.(e)
    }
  }, 0)
  return stream
}

/**
 * pdf-lib 1.17 subsets fonts through `subset.encodeStream()`. fontkit 2 (smaller than
 * @pdf-lib/fontkit, with its subsetting fixes) only has `subset.encode()`, so add the stream.
 */
export function adaptFontkit(fontkit: { create(buffer: Uint8Array): FontkitFont }): Fontkit {
  return {
    create(buffer) {
      const font = fontkit.create(buffer)
      const createSubset = font.createSubset.bind(font)
      font.createSubset = () => {
        const subset = createSubset()
        return Object.assign(subset, { encodeStream: () => streamOf(() => subset.encode()) })
      }
      return font as unknown as ReturnType<Fontkit['create']>
    },
  }
}

let loading: Promise<Fontkit> | null = null

/** fontkit is about 150 KB gzipped, so it loads on the first export that needs a bundled font. */
export function loadFontkit(): Promise<Fontkit> {
  loading ??= import('fontkit').then(adaptFontkit, () => {
    loading = null
    throw new FontsUnavailableError()
  })
  return loading
}
