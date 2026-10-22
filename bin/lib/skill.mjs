// The shell helper is also used without Node by the Herdr installer.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function refreshSkill(env = process.env) {
  // One-shot handoff from the detached updater; never pass it to the server.
  const refreshed = env.WHERDR_SKILL_REFRESHED === '1'
  delete env.WHERDR_SKILL_REFRESHED
  delete process.env.WHERDR_SKILL_REFRESHED
  if (refreshed || env.WHERDR_SKILL === 'off') return
  try {
    spawnSync('sh', [fileURLToPath(new URL('./install-skill.sh', import.meta.url))], {
      env, stdio: 'ignore', timeout: 5000,
    })
  } catch {} // Optional: a read-only home or missing shell must not prevent startup.
}
