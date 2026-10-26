// A loading state worth showing: true only once `on` has lasted `delay` ms (a
// short load shows nothing, so nothing flashes), then kept for at least `min`
// ms once shown (a skeleton never blinks for a frame). Skeletons of the Board
// and of a conversation (BoardSkeleton, ChatSkeleton).
import { onScopeDispose, ref, watch, type Ref } from 'vue'

export function useDelayedFlag(on: Ref<boolean>, delay = 300, min = 300): Ref<boolean> {
  const shown = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let since = 0
  const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
  watch(on, (v) => {
    clear()
    if (v && !shown.value) {
      timer = setTimeout(() => { timer = null; shown.value = true; since = Date.now() }, delay)
    } else if (!v && shown.value) {
      const left = min - (Date.now() - since)
      if (left <= 0) shown.value = false
      else timer = setTimeout(() => { timer = null; shown.value = false }, left)
    }
  }, { immediate: true })
  onScopeDispose(clear)
  return shown
}
