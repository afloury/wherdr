// A failed step action's badge said for people (shared/pm/refusal.ts).
import { refusalSaid } from '#shared/pm/refusal'

export const stepRefusalText = (badge: string, told = false) => tl(refusalSaid(badge, told).long)
