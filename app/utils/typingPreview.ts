// Preview of the typewriter effect in Settings: a sample agent
// reply (sentences, list, code block), rendered and revealed as in
// the conversation (ChatMarkdown), replayed on each settings change.
import type { TypingSpeed } from './typewriter'

const SAMPLE_FR = `J’ai trouvé la cause : le cache n’était jamais invalidé après une mise à jour. Le correctif tient en trois points :

- vider l’entrée à chaque écriture ;
- ajouter un test de régression ;
- garder la durée de vie à 5 minutes.

\`\`\`ts
cache.delete(key)
await save(item)
\`\`\`

Tous les tests passent.`

const SAMPLE_EN = `Found the cause: the cache was never invalidated after an update. The fix has three parts:

- clear the entry on every write;
- add a regression test;
- keep the time to live at 5 minutes.

\`\`\`ts
cache.delete(key)
await save(item)
\`\`\`

All tests pass.`

export const typingSample = (lang: string): string => (lang === 'fr' ? SAMPLE_FR : SAMPLE_EN)

// Start time of the reveal: none when the effect is off (setting, or
// reduced motion by the system): the sample shows all at once.
export const previewStart = (speed: TypingSpeed, now: number): number | null => (speed === 'off' ? null : now)
