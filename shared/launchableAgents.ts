// Valeurs de `herdr agent start --kind` (Herdr 0.9.1). Garder cette liste
// distincte des agents installés, qui varient selon la machine.
export const HERDR_AGENT_KINDS = [
  'pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline',
  'omp', 'mastracode', 'opencode', 'copilot', 'kimi', 'kiro', 'droid',
  'amp', 'grok', 'hermes', 'kilo', 'qodercli', 'qwen', 'letta', 'maki', 'muse',
] as const

export function availableAgentKinds(found: Iterable<string>, allowed: readonly string[] = HERDR_AGENT_KINDS): string[] {
  const installed = new Set(found)
  return HERDR_AGENT_KINDS.filter(k => allowed.includes(k) && installed.has(k))
}
