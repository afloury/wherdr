// Settings kept on the server (utils/syncedSettings.ts): one store for the
// app, and `syncedRef`, a ref that reads its key from the local copy at once,
// sends its changes to the server and follows the other devices' changes.
import type { Ref } from 'vue'
import type { SyncedSetting } from '#shared/settings'
import { createSettingsSync } from '~/utils/syncedSettings'

export const settingsSync = createSettingsSync({
  local: {
    get(k) { try { return localStorage.getItem(k) } catch { return null } },
    set(k, v) { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
    remove(k) { try { localStorage.removeItem(k) } catch { /* storage unavailable */ } },
  },
})
// The server side (`api`) is plugged in by useHerdr.ts, which imports this file.

// `read` turns the stored text into the value (the setting's own parser,
// with its default for null); `write` turns the value back into text.
export function syncedRef<T>(key: SyncedSetting, read: (raw: string | null) => T, write: (value: T) => string | null, opts: { deep?: boolean } = {}): Ref<T> {
  const stored = () => { try { return localStorage.getItem(key) } catch { return null } }
  const value = ref(read(stored())) as Ref<T>
  const unbind = settingsSync.bind(key, (raw) => { value.value = read(raw) })
  // A value just applied from the server reads back as the copy: not sent again.
  watch(value, (v) => {
    const raw = write(v)
    if (raw === write(read(stored()))) return
    settingsSync.write(key, raw)
  }, { deep: opts.deep })
  if (getCurrentScope()) onScopeDispose(unbind)
  return value
}

export const flag = { read: (on: boolean) => (raw: string | null) => (raw === null ? on : raw !== '0'), write: (v: boolean) => (v ? '1' : '0') }
