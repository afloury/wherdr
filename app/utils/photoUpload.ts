// Photo for an agent (message field, terminal paste): shrunk in the browser,
// stored by the server and copied to the agent's machine (/api/upload).
import { t } from './i18n'

// 2048 px JPEG at most. Unreadable image: sent as is.
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    const g = c.getContext('2d')!
    // JPEG without transparency: white background, otherwise transparent areas
    // (PNG screenshots) turn black.
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.86))
    if (blob) return blob
  } catch { /* unreadable image: sent as is */ }
  finally { URL.revokeObjectURL(url) }
  return file
}

// `path`: where the agent reads it on its machine; `name`: the app's copy
// (/uploads/<name>). Throws the server's reason, translated.
export async function uploadPhoto(paneId: string, file: Blob): Promise<{ path: string, name: string }> {
  const blob = await shrinkPhoto(file)
  const r = await fetch(`/api/upload?pane=${encodeURIComponent(paneId)}`, { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(t(d.error || `HTTP ${r.status}`))
  return { path: d.path, name: d.name }
}
