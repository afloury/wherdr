// #/review (and #/decisions, the former Decisions page) opens Tasks to review
// over the page the user is on; the app started on it: over Home.
import { REVIEW_PATHS } from '../../shared/appLinks'

// from: the page shown, null while the app starts. 'stay': keep it, open the sheet over it.
export function reviewRoute(to: string, from: string | null): 'stay' | '/' | null {
  if (!REVIEW_PATHS.includes(to)) return null
  return from ? 'stay' : '/'
}
