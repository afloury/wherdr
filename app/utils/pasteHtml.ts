// DOMParser is inert: clipboard markup is never mounted in the document.
// textContent alone would concatenate adjacent blocks and discard <br>.
export function pasteHtmlText(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  let text = ''
  let pending = 0
  const boundary = (lines: number) => { pending = Math.max(pending, lines) }
  function append(value: string) {
    if (!value) return
    if (text && pending) {
      const trailing = text.match(/\n*$/)![0].length
      text += '\n'.repeat(Math.max(0, pending - trailing))
    }
    pending = 0
    text += value
  }
  function visit(node: Node, pre = false) {
    if (node.nodeType === 3) {
      const value = node.textContent || ''
      // Ignore source indentation between blocks, but keep inline word spaces.
      if (pending && !value.trim() && !pre) return
      append(pre ? value : value.replace(/[\t\n\r ]+/g, ' '))
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) return
    if (el.tagName === 'BR') { append('\n'); return }
    const lines = el.tagName === 'P' ? 2
      : /^(DIV|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE|LI|UL|OL|TR|H[1-6])$/.test(el.tagName) ? 1 : 0
    if (lines) boundary(lines)
    for (const child of el.childNodes) visit(child, pre || el.tagName === 'PRE')
    if (lines) boundary(lines)
  }
  for (const node of body.childNodes) visit(node)
  return text
}
