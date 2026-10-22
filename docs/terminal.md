# Terminal

[Documentation](README.md) · [Project](../README.md)

- **Terminal view**: the real terminal (xterm.js, WebGL or DOM renderer) with take-over. Opening
  it resizes the real pane to your screen (or its cell in a split); closing it gives the pane the size it had before
  (after 30 seconds when the connection just dropped, e.g. a locked phone), unless a Herdr
  client attached meanwhile laid it out its own way. On a
  computer, drag over the text on screen to select it: releasing the button copies it, as do
  `⌘C` / `Ctrl+Shift+C`. The history is browsed with the wheel, not by dragging past the edge.
  Links (OSC 8 hyperlinks and plain `http(s)://` URLs, even wrapped over several rows) open in a
  new tab with `⌘`+click / `Ctrl`+click, or a tap on a phone; only http and https open. A long
  line wrapped by the width is copied in one piece, without the breaks between its rows. An image
  pasted with `⌘V` (Mac), here or in a side-by-side terminal, goes to the agent's machine and its
  path is pasted, which omp and Claude Code attach as an image, as in the conversation.
