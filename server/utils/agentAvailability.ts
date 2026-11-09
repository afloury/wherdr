// Prints each given command found on the machine (shell script, commands as arguments).
export const KIND_PROBE_SCRIPT = `PATH="$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
for cmd do command -v "$cmd" >/dev/null 2>&1 && printf '%s\\n' "$cmd"; done; exit 0`
