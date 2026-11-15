// xterm.js and its add-ons (≈ 390 KB of script), downloaded the first time a
// terminal is shown: a conversation read in chat mode never loads them. A
// failed download (network gone) is forgotten, so the next attempt fetches again.
type Core = { Terminal: typeof import('@xterm/xterm').Terminal, FitAddon: typeof import('@xterm/addon-fit').FitAddon }
type Webgl = { WebglAddon: typeof import('@xterm/addon-webgl').WebglAddon }

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    if (!pending) {
      pending = load()
      pending.catch(() => { pending = null })
    }
    return pending
  }
}

export const loadXterm = once<Core>(async () => {
  const [xterm, fit] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
  return { Terminal: xterm.Terminal, FitAddon: fit.FitAddon }
})

export const loadWebgl = once<Webgl>(async () => {
  const { WebglAddon } = await import('@xterm/addon-webgl')
  return { WebglAddon }
})
