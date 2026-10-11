// The shell helper is also used without Node by the Docker / Herdr installer.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function refreshSkill(env = process.env) {
  try {
    spawnSync('sh', [fileURLToPath(new URL('./install-skill.sh', import.meta.url))], {
      env, stdio: 'ignore', timeout: 5000,
    })
  } catch {} // Optional: a read-only home or missing shell must not prevent startup.
}
