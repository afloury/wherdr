// t-0283 mock-ups (throwaway): decorates the last agent reply of the demo for
// one variant. Every control is a `.q-reply[data-q]`, so the app's own click
// handler quotes it in the field (ChatView.vue, onListClick).
window.__proto = (v, state) => {
  const root = [...document.querySelectorAll('.msg-ai .md-body')].at(-1)
  document.documentElement.dataset.proto = v
  if (v === '0') return
  const touch = matchMedia('(hover: none)').matches
  const textOf = (el) => {
    const c = el.cloneNode(true)
    c.querySelectorAll('button, .p-float').forEach(b => b.remove())
    return c.textContent.replace(/\s+/g, ' ').trim()
  }
  const blocks = [...root.querySelectorAll('p, li')]
  const points = blocks.filter(b => !b.querySelector('.q-reply') && !/:$/.test(textOf(b)))
  const questions = [...root.querySelectorAll('.q-reply')]
  const target = points[1]
  const DISCUSS = 'Discuter'
  const mk = (cls, q, label) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `q-reply ${cls}`
    b.dataset.q = q
    b.dataset.l = label
    b.dataset.lq = 'Cité'
    return b
  }
  // The words of a question, wrapped in spans (from its button backwards).
  const wrap = (btn) => {
    let need = btn.dataset.q.length
    const spans = []
    let n = btn.previousSibling
    while (n && need > 0) {
      const prev = n.previousSibling
      let len = n.textContent.length
      if (n.nodeType === 3 && len > need) { n = n.splitText(len - need); len = need }
      const s = document.createElement('span')
      s.className = 'q-text'
      n.replaceWith(s)
      s.appendChild(n)
      spans.push(s)
      need -= len
      n = prev
    }
    return spans
  }

  if (v === 'A' || v === 'B') {
    for (const p of points) p.appendChild(mk('p-disc', textOf(p), DISCUSS))
    if (v === 'A' && state === 'gesture') target.classList.add('p-swipe')
  }

  if (v === 'C') {
    const box = root.getBoundingClientRect()
    // Left margin on the computer; a right-hand rail on the phone (no room on the left).
    const base = touch ? box.right - 16 : box.left - 22
    const place = (block, btn, anchor) => {
      const r = block.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(block).lineHeight)
      const a = anchor?.getBoundingClientRect()
      btn.style.left = `${base - r.left}px`
      btn.style.top = `${a ? a.top + a.height / 2 - r.top - 8 : (lh - 16) / 2}px`
      block.appendChild(btn)
    }
    for (const q of questions) {
      const b = mk('p-gut is-q', q.dataset.q, 'Répondre')
      place(q.closest('p, li'), b, q)
    }
    for (const p of points) place(p, mk('p-gut', textOf(p), DISCUSS))
  }

  if (v === 'D' || v === 'R5') {
    for (const q of questions) for (const s of wrap(q)) s.addEventListener('click', () => { q.click(); s.classList.add('quoted') })
  }
  if (v === 'D') {
    for (const p of points) {
      p.classList.add('p-pt')
      p.dataset.l = DISCUSS
      const hidden = mk('p-disc', textOf(p), DISCUSS)
      p.appendChild(hidden)
      if (!touch) p.addEventListener('click', () => { if (getSelection().isCollapsed) hidden.click() })
    }
    if (state === 'gesture') {
      target.classList.add('p-press')
      const bar = document.createElement('div')
      bar.className = 'p-float'
      bar.innerHTML = '<button type="button"><b>↳</b> Discuter</button><button type="button">Copier</button>'
      target.appendChild(bar)
    }
  }

  if (v === 'E') {
    const bar = document.createElement('div')
    bar.className = 'p-bar'
    bar.innerHTML = `<div class="p-bar-h">${questions.length} questions · répondre à</div>`
    questions.forEach((q, i) => {
      q.dataset.n = String(i + 1)
      const spans = wrap(q)
      const chip = mk('p-chip', q.dataset.q, 'Répondre')
      chip.dataset.n = String(i + 1)
      chip.innerHTML = `<span></span><i>↳ ${touch ? '' : 'Répondre'}</i>`
      chip.firstChild.textContent = q.dataset.q
      const hot = on => spans.forEach(s => s.classList.toggle('q-hot', on))
      chip.addEventListener('mouseenter', () => hot(true))
      chip.addEventListener('mouseleave', () => hot(false))
      bar.appendChild(chip)
    })
    const pick = document.createElement('button')
    pick.type = 'button'
    pick.className = 'p-pick'
    const label = on => { pick.textContent = on ? 'Touche le point à citer · Annuler' : '+ Citer un point' }
    label(false)
    const setPick = (on) => {
      if (on) document.documentElement.dataset.pick = '1'
      else delete document.documentElement.dataset.pick
      label(on)
    }
    pick.addEventListener('click', () => setPick(!document.documentElement.dataset.pick))
    bar.appendChild(pick)
    for (const p of points) {
      p.classList.add('p-pt')
      const hidden = mk('p-disc', textOf(p), DISCUSS)
      hidden.style.display = 'none'
      p.appendChild(hidden)
      p.addEventListener('click', () => { if (document.documentElement.dataset.pick) { hidden.click(); setPick(false) } })
    }
    root.appendChild(bar)
    if (state === 'gesture') { setPick(true); target.classList.add('p-on') }
  }
}
