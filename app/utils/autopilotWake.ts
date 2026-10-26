// Presentation only: classify the original transcript item before parsing replies.
export function isAutopilotWake(item: { role: string, text: string }): boolean {
  return item.role === 'user' && (item.text.startsWith('Autopilot:') || item.text.startsWith('Autopilot woke:'))
}
