// Toasts after a copy from a terminal selection (computer terminal, mirror).
import type { SelectionOptions } from '~/utils/terminalSelection'

export function useTerminalCopyFeedback(): Pick<SelectionOptions, 'copied' | 'ready'> {
  const mac = /Macintosh|Mac OS X|iPhone|iPad/.test(navigator.userAgent)
  return {
    copied: ok => toast(ok ? t('Copied') : t('Copy failed'), false, ok ? undefined : t('The browser denied clipboard access.')),
    // Copy on release refused (long drag, release outside the window): not an
    // error, the selection stays and a key or the button copies it.
    ready: copy => toast(t('Selection ready'), false, t('Press {key} to copy it.').replace('{key}', mac ? '⌘C' : 'Ctrl+C'), { label: t('Copy'), run: copy }),
  }
}
