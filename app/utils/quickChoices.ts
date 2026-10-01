import type { Choices } from '#shared/types'

// One-tap answers (list card, plan cell): without the free-answer option, which
// needs a text (agent view). `i`: index on screen.
export function quickChoices(prompt: Choices | null | undefined, max: number): { label: string, i: number }[] {
  return prompt ? prompt.options.flatMap((o, i) => (o.free ? [] : [{ label: o.label, i }])).slice(0, max) : []
}
