import type { ModelInfo, ModelOption } from '#shared/types'

// Claude affiche parfois « Opus (1M) » alors que sa description donne
// « Opus 5.5 with 1M context » et la transcription « Opus 5.5 (1M) ».
const key = (value: string) => value.toLowerCase()
  .replace(/\bwith 1m context\b/g, '(1m)')
  .replace(/\b1m context\b/g, '1m')
  .replace(/\s*\((?:default|current)\)/g, '')
  .replace(/\s+/g, ' ').trim()

export function modelOptionCurrent(option: ModelOption, model: ModelInfo | null | undefined): boolean {
  if (!model) return false
  const wanted = key(model.label)
  if (key(option.label) === wanted) return true
  const hintName = option.hint?.split('·')[0]?.trim() || ''
  return Boolean(hintName) && key(hintName) === wanted
}

export function currentModelOption(options: ModelOption[], model: ModelInfo | null | undefined): number {
  // Préférer le nom explicite à « Default (recommended) » quand les deux
  // pointent vers le même modèle. Ne cocher qu'une seule ligne.
  const explicit = options.findIndex(o => !/^default\b/i.test(o.label) && modelOptionCurrent(o, model))
  return explicit >= 0 ? explicit : options.findIndex(o => modelOptionCurrent(o, model))
}
