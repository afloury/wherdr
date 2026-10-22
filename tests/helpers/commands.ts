import { spawnSync } from 'node:child_process'

// Probe capabilities, not distro or Node versions. Shell integration tests run
// on hosts with these tools; pure tests stay enabled in minimal images.
export function hasCommands(...commands: string[]): boolean {
  return commands.every(command => spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command], {
    stdio: 'ignore',
  }).status === 0)
}
