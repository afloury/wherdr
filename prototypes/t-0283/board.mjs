// t-0283 mock-ups (throwaway): the two comparison boards, from the screenshots.
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { VARIANTS } from './variants.mjs'

const OUT = '/app/.shots/t-0283'
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const base = `
  * { box-sizing: border-box; margin: 0; }
  body { background: #0d1015; color: #e6eaf2; font: 14px/1.4 Inter, system-ui, sans-serif; padding: 28px; width: max-content; }
  h1 { font: 700 26px/1.1 Archivo, Inter, sans-serif; margin-bottom: 4px; }
  .sub { font: 500 11px/1.4 "JetBrains Mono", monospace; letter-spacing: .08em; text-transform: uppercase; color: #828a9a; margin-bottom: 22px; }
  .tag { display: inline-grid; place-items: center; width: 26px; height: 26px; margin-right: 10px; font: 700 14px/1 "JetBrains Mono", monospace; color: #0d1015; background: #1fb2ff; }
  .tag.z { background: #828a9a; }
  .name { font: 700 17px/1.2 Archivo, Inter, sans-serif; display: flex; align-items: center; }
  .cap { font: 500 10.5px/1.4 "JetBrains Mono", monospace; letter-spacing: .06em; text-transform: uppercase; color: #828a9a; margin: 0 0 6px; }
  .note { color: #9da5b4; font-size: 12.5px; margin: 6px 0 0; }
  .shot { border: 1px solid #2a3038; overflow: hidden; position: relative; background: #12151b; }
  .shot img { display: block; position: absolute; }
`
const W = 770, H = 486, X = 428, Y = 214
const desktop = `<!doctype html><meta charset="utf-8"><style>${base}
  .row { display: grid; grid-template-columns: ${W}px ${W}px; gap: 8px 18px; margin-bottom: 30px; }
  .row .name, .row .note { grid-column: 1 / -1; }
  .shot { width: ${W}px; height: ${H}px; }
  .shot img { width: 1280px; left: -${X}px; top: -${Y}px; }
</style><h1>Répondre à une question, discuter d’un point — ordinateur</h1><p class="sub">1280 px · thème Titanium · à gauche au repos, à droite au survol du 2ᵉ point</p>
${VARIANTS.map(v => `<div class="row"><div class="name"><span class="tag ${v.id === '0' ? 'z' : ''}">${v.id}</span>${esc(v.name)}</div>
  <div><p class="cap">Repos</p><div class="shot"><img src="${v.id}-desktop-rest.png"></div></div>
  <div><p class="cap">Survol</p><div class="shot"><img src="${v.id}-desktop-hover.png"></div></div>
  <p class="note">${esc(v.desktop)}</p></div>`).join('')}`
const PW = 312, PH = Math.round(844 * PW / 390)
const phone = `<!doctype html><meta charset="utf-8"><style>${base}
  .grid { display: grid; grid-template-columns: repeat(${VARIANTS.length}, ${PW}px); gap: 10px 18px; }
  .shot { width: ${PW}px; height: ${PH}px; }
  .shot img { width: ${PW}px; left: 0; top: 0; }
  .none { display: grid; place-items: center; width: ${PW}px; height: ${PH}px; border: 1px dashed #2a3038; color: #828a9a; font: 500 11px/1.5 "JetBrains Mono", monospace; letter-spacing: .06em; text-transform: uppercase; text-align: center; }
  .note { min-height: 36px; margin: 0; }
  .cap { margin: 12px 0 0; }
</style><h1>Répondre à une question, discuter d’un point — iPhone</h1><p class="sub">390 px · thème Titanium · en haut au repos, en bas le geste ou son résultat</p>
<div class="grid">
${VARIANTS.map(v => `<div class="name"><span class="tag ${v.id === '0' ? 'z' : ''}">${v.id}</span>${esc(v.name)}</div>`).join('')}
${VARIANTS.map(v => `<p class="note">${esc(v.phone)}</p>`).join('')}
${VARIANTS.map(v => `<div class="shot"><img src="${v.id}-phone-rest.png"></div>`).join('')}
${VARIANTS.map(v => `<p class="cap">${esc(v.gesture || '—')}</p>`).join('')}
${VARIANTS.map(v => v.gesture ? `<div class="shot"><img src="${v.id}-phone-gesture.png"></div>` : `<div class="none">Pas de geste :<br>sélectionner le texte</div>`).join('')}
</div>`
const NAMES = ['Étiquette bordée (actuelle)', 'Étiquette sans cadre', 'Icône seule', 'Icône encadrée', 'Soulignement pointillé', 'Pastille']
const reply = `<!doctype html><meta charset="utf-8"><style>${base}
  .grid { display: grid; grid-template-columns: repeat(2, 700px); gap: 18px 24px; }
  .shot { width: 700px; height: 46px; } .shot img { position: static; width: 700px; }
  .name { font-size: 14px; margin-bottom: 8px; } .tag { width: 22px; height: 22px; font-size: 12px; }
</style><h1>Le bouton Reply seul</h1><p class="sub">six dessins sur la même question de fin de message</p>
<div class="grid">${NAMES.map((n, i) => `<div><div class="name"><span class="tag">${i + 1}</span>${n}</div><div class="shot"><img src="R${i + 1}.png"></div></div>`).join('')}</div>`

const browser = await chromium.launch()
for (const [name, html] of [['planche-ordinateur', desktop], ['planche-iphone', phone], ['planche-bouton-reply', reply]]) {
  writeFileSync(`${OUT}/_${name}.html`, html)
  const page = await browser.newPage({ deviceScaleFactor: 1.5 })
  await page.goto(`file://${OUT}/_${name}.html`)
  await page.waitForLoadState('networkidle')
  const size = await page.evaluate(() => ({ width: Math.ceil(document.body.scrollWidth), height: Math.ceil(document.body.scrollHeight) }))
  await page.setViewportSize(size)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await page.close()
  console.log('ok', name, size)
}
await browser.close()
