// t-0283 mock-ups (throwaway): the standalone index.html of the deliverable.
import { writeFileSync } from 'node:fs'
import { VARIANTS } from './variants.mjs'

const TEXT = {
  0: ['Référence : une étiquette « ↳ Répondre » pâle après la question du milieu ; celle de la question finale n’apparaît qu’au survol sur ordinateur ; rien pour les points.', 'Incohérent (on ne devine pas le bouton de fin) et aucun moyen rapide de citer un point, sauf sélectionner le texte.'],
  A: ['La même étiquette « ↳ Répondre », toujours visible, après chaque question. Un point montre « ↳ Discuter » en pointillé au survol ; sur iPhone on glisse le point vers la gauche.', 'Gagne : se lit sans apprentissage, c’est l’existant rendu cohérent. Perd : l’étiquette pèse dans un message à 4-5 questions, et le glissement ne se devine pas et se heurte au balayage entre panneaux.'],
  B: ['Un simple « ↳ » couleur d’accent après chaque question, partout. Les points ont le même « ↳ » en gris : au survol sur ordinateur, pâle et permanent sur iPhone. Cité : il devient « ✓ ».', 'Gagne : le plus léger, un seul signe pour tout, aucun geste à apprendre, identique sur les deux supports. Perd : sans mot, il faut le découvrir une fois ; sur iPhone une longue liste porte un « ↳ » pâle par ligne.'],
  C: ['Le texte reste intact. Un carré « ↳ » dans la marge marque la ligne de chaque question ; un « + » apparaît au survol d’un point (le point se teinte). Sur iPhone, une colonne de repères à droite du texte.', 'Gagne : lecture jamais interrompue, repères alignés et faciles à balayer du regard. Perd : le repère est loin de la question (deux questions dans un paragraphe = deux carrés à démêler) ; sur iPhone la colonne prend 26 px de largeur de texte.'],
  D: ['Aucun bouton : la question est soulignée en pointillé et se touche. Un point se teinte au survol et se cite d’un clic ; sur iPhone, appui long sur le point → petite barre « Discuter · Copier ».', 'Gagne : rien d’ajouté dans le texte, cible large. Perd : le souligné ressemble à un lien, le clic sur un point gêne la sélection de texte, et l’appui long entre en conflit avec la sélection native d’iOS (déjà utilisée pour « répondre à un passage »).'],
  E: ['Le texte ne porte qu’un petit numéro après chaque question. Sous le message, une barre liste les questions détectées (un toucher = citée) et un bouton « + Citer un point » rend chaque point touchable.', 'Gagne : toutes les questions rassemblées, impossible d’en oublier une ; rien ne dépend du survol. Perd : la barre allonge chaque message à questions, répète le texte, et citer un point demande deux touchers.'],
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const fig = (file, cap, cls = '') => `<figure class="${cls}"><a href="${file}"><img loading="lazy" src="${file}" alt="${esc(cap)}"></a><figcaption>${esc(cap)}</figcaption></figure>`
const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>t-0283 — Répondre à une question, discuter d’un point</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 24px 80px; background: #0d1015; color: #e6eaf2; font: 15px/1.55 Inter, system-ui, sans-serif; }
  main { max-width: 1240px; margin: 0 auto; }
  h1 { font: 700 30px/1.1 Archivo, Inter, system-ui, sans-serif; margin: 0 0 6px; }
  h2 { display: flex; align-items: center; gap: 12px; font: 700 20px/1.2 Archivo, Inter, system-ui, sans-serif; margin: 56px 0 12px; padding-top: 20px; border-top: 1px solid #2a3038; }
  .mono, figcaption, nav a { font: 500 11px/1.4 "JetBrains Mono", ui-monospace, monospace; letter-spacing: .07em; text-transform: uppercase; color: #828a9a; }
  .tag { display: inline-grid; place-items: center; width: 28px; height: 28px; font: 700 14px/1 "JetBrains Mono", ui-monospace, monospace; color: #0d1015; background: #1fb2ff; }
  .tag.z { background: #828a9a; }
  .rec { font: 500 10px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: #00f28a; border: 1px solid #00f28a; padding: 5px 7px; }
  p { margin: 0 0 8px; max-width: 900px; color: #c3c9d3; }
  p b { color: #e6eaf2; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
  nav a { padding: 7px 10px; border: 1px solid #2a3038; text-decoration: none; color: #e6eaf2; }
  nav a:hover { border-color: #1fb2ff; }
  figure { margin: 0; }
  figure img { display: block; width: 100%; border: 1px solid #2a3038; }
  figcaption { margin-top: 6px; }
  .shots { display: grid; grid-template-columns: 1fr 1fr .33fr .33fr; gap: 14px; align-items: start; margin-top: 16px; }
  .wide { margin-top: 16px; }
  @media (max-width: 800px) { .shots { grid-template-columns: 1fr 1fr; } }
</style></head><body><main>
<p class="mono">wherdr · t-0283 · maquettes, rien n’est fusionné</p>
<h1>Répondre à une question, discuter d’un point</h1>
<p>Cinq variantes (A à E) prototypées dans la vraie app (démo, thème Titanium), sur le même message : une question au milieu d’un paragraphe, trois points, une question finale. « 0 » est l’app actuelle. Cliquer une image l’ouvre en grand.</p>
<nav>${VARIANTS.map(v => `<a href="#v${v.id}">${v.id} · ${esc(v.name)}</a>`).join('')}<a href="#bouton">Le bouton seul</a><a href="#reco">Recommandation</a></nav>

<h2>Planches comparatives</h2>
${fig('planche-ordinateur.png', 'Ordinateur, 1280 px : repos à gauche, survol à droite', 'wide')}
${fig('planche-iphone.png', 'iPhone, 390 px : repos en haut, geste ou résultat en bas', 'wide')}

${VARIANTS.map(v => `<h2 id="v${v.id}"><span class="tag ${v.id === '0' ? 'z' : ''}">${v.id}</span>${esc(v.name)}${v.id === 'B' ? '<span class="rec">recommandée</span>' : ''}</h2>
<p><b>Ce qu’on voit.</b> ${esc(TEXT[v.id][0])}</p>
<p><b>${v.id === '0' ? 'Le problème' : 'Gagne / perd'}.</b> ${esc(TEXT[v.id][1])}</p>
<div class="shots">
${fig(`${v.id}-desktop-rest.png`, 'Ordinateur · repos')}
${fig(`${v.id}-desktop-hover.png`, v.id === 'E' ? 'Ordinateur · survol d’une ligne de la barre' : 'Ordinateur · survol du 2ᵉ point')}
${fig(`${v.id}-phone-rest.png`, 'iPhone · repos')}
${v.gesture ? fig(`${v.id}-phone-gesture.png`, `iPhone · ${v.gesture}`) : ''}
</div>`).join('\n')}

<h2 id="bouton">Le bouton Reply seul</h2>
<p>Six dessins du même bouton sur la question finale, toujours visibles. 1 est l’étiquette actuelle ; 3 est celui de la variante B, 5 celui de D.</p>
${fig('planche-bouton-reply.png', 'Six dessins du bouton Reply', 'wide')}

<h2 id="reco">Recommandation : B, l’icône seule</h2>
<p>Un seul signe, « ↳ », pour les deux actions : en couleur d’accent quand l’agent attend une réponse, en gris quand on peut simplement rebondir sur un point. Il règle l’incohérence milieu / fin, ne demande aucun geste caché sur iPhone et reste le plus discret à la lecture. Détails et coût dans <a href="README.md" style="color:#1fb2ff">README.md</a>.</p>
<div class="shots">
${fig('B-desktop-quoted.png', 'B · une question et un point cités')}
${fig('B-desktop-light.png', 'B · thème clair, survol')}
${fig('B-phone-quoted.png', 'B · iPhone, question citée')}
${fig('B-phone-light.png', 'B · iPhone, thème clair')}
</div>
</main></body></html>
`
writeFileSync(process.argv[2], html)
