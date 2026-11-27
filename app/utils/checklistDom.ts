// The task-list boxes a message rendered (`- [ ]` / `- [x]`, utils/markdown.ts keeps only
// those as disabled checkboxes) and their items: what the page shows is what is stored and
// sent, so a quoted list, code or a comment that looks like a list never shifts the indexes.
import { MAX_TEXT, type ChecklistItem } from '#shared/checklist'

const SEP = ' › '

// A task item's box opens its list item (or the item's first paragraph, in a loose list).
function isTaskBox(box: HTMLInputElement): boolean {
  const host = box.parentElement
  if (!host) return false
  const inItem = host.tagName === 'LI' || (host.tagName === 'P' && host.parentElement?.tagName === 'LI')
  return inItem && host.firstElementChild === box && !host.firstChild?.textContent?.trim()
}

export function taskBoxes(root: ParentNode | null | undefined): HTMLInputElement[] {
  return Array.from(root?.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]') ?? [])
    .filter(b => b.parentElement?.classList.contains('md-check-row') || (b.disabled && isTaskBox(b)))
}

// A list item's own words, without its sub-lists.
function ownText(li: Element): string {
  const copy = li.cloneNode(true) as Element
  for (const sub of copy.querySelectorAll('ul, ol')) sub.remove()
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// Each box's item: its text after its parents' (`Alert card › one layout`), and whether the
// agent ticked it.
export function taskItems(root: Element, boxes = taskBoxes(root)): ChecklistItem[] {
  return boxes.map((box, index) => {
    const labels: string[] = []
    for (let li = box.closest('li'); li && root.contains(li); li = li.parentElement?.closest('li') ?? null) {
      const own = ownText(li)
      if (own) labels.unshift(own)
    }
    return { index, text: labels.join(SEP).slice(0, MAX_TEXT), written: box.defaultChecked }
  })
}

// On a phone the whole row is the tap target: the box and its words go in one row, the
// words wrapping under themselves, never under the box.
export function wrapTaskRow(box: HTMLInputElement): void {
  const host = box.parentElement
  if (!host || host.classList.contains('md-check-row')) return
  const row = document.createElement('span')
  row.className = 'md-check-row'
  const words = document.createElement('span')
  words.className = 'md-check-text'
  let n = box.nextSibling
  while (n && !(n instanceof Element && /^(UL|OL|P|DIV|PRE|BLOCKQUOTE|TABLE|DETAILS)$/.test(n.tagName))) {
    const next = n.nextSibling
    words.appendChild(n)
    n = next
  }
  host.insertBefore(row, box)
  row.append(box, words)
  box.closest('li')?.classList.add('md-task')
}
