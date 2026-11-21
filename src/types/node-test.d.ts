// The two Node APIs the unit tests use to read bundled font files, without pulling @types/node
// (and its globals) into the browser app's type-check.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}
