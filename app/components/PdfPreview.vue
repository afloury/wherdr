<script setup lang="ts">
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
// URL assets keep PDF.js out of shared chunks and the PWA precache.
import pdfModuleUrl from 'pdfjs-dist/build/pdf.min.mjs?url'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfOutputScale } from '~/utils/pdfPreview'

const props = defineProps<{ src: string, title: string }>()
const root = ref<HTMLElement>()
const count = ref(0)
const ratio = ref(2 / 3)
const loading = ref(true)
const failed = ref(false)
let document: PDFDocumentProxy | undefined
let task: PDFDocumentLoadingTask | undefined
let renderTask: RenderTask | undefined
let observer: IntersectionObserver | undefined
let resize: ResizeObserver | undefined
let stopped = false
let revision = 0
let running = false
let width = 0
const nearby = new Set<HTMLElement>()

// One render at a time. Only nearby pages retain a bitmap; placeholders keep
// the document's scroll position when canvases are released.
async function draw() {
  if (running || stopped || !document || !width) return
  running = true
  try {
    for (const host of nearby) {
      if (stopped) break
      if (host.querySelector('canvas')) continue
      const version = revision
      const page = await document.getPage(Number(host.dataset.page))
      if (stopped || version !== revision || !nearby.has(host)) continue
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      host.style.aspectRatio = `${base.width} / ${base.height}`
      const canvas = window.document.createElement('canvas')
      const scale = pdfOutputScale(viewport.width, viewport.height, window.devicePixelRatio || 1)
      canvas.width = Math.ceil(viewport.width * scale)
      canvas.height = Math.ceil(viewport.height * scale)
      const context = canvas.getContext('2d')!
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: [scale, 0, 0, scale, 0, 0] })
      try {
        await renderTask.promise
        if (!stopped && version === revision && nearby.has(host)) {
          host.replaceChildren(canvas)
          host.dataset.rendered = 'true'
        } else canvas.width = canvas.height = 0
      } catch (e) {
        if ((e as Error).name !== 'RenderingCancelledException') throw e
      } finally { renderTask = undefined; page.cleanup() }
    }
  } catch { if (!stopped) failed.value = true }
  finally {
    running = false
    if (!stopped && !failed.value && [...nearby].some(host => !host.querySelector('canvas'))) void draw()
  }
}
function release(host: HTMLElement) {
  const canvas = host.querySelector('canvas')
  if (canvas) { canvas.width = canvas.height = 0; canvas.remove() }
  delete host.dataset.rendered
}
onMounted(async () => {
  try {
    // Both the library and its same-origin worker are fetched only for a PDF.
    const pdf = await import(/* @vite-ignore */ pdfModuleUrl) as typeof import('pdfjs-dist')
    if (stopped) return
    pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    task = pdf.getDocument({ url: props.src, withCredentials: true, isEvalSupported: false })
    document = await task.promise
    if (stopped) return
    const first = await document.getPage(1)
    const size = first.getViewport({ scale: 1 })
    ratio.value = size.height / size.width
    first.cleanup()
    count.value = document.numPages
    loading.value = false
    await nextTick()
    if (stopped || !root.value) return
    width = root.value.clientWidth
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const host = entry.target as HTMLElement
        if (entry.isIntersecting) nearby.add(host)
        else { nearby.delete(host); release(host) }
      }
      void draw()
    }, { rootMargin: '400px 0px' })
    root.value.querySelectorAll<HTMLElement>('.pdf-page').forEach(host => observer!.observe(host))
    resize = new ResizeObserver(() => {
      const next = root.value?.clientWidth || 0
      if (!next || next === width) return
      width = next
      revision++
      renderTask?.cancel()
      nearby.forEach(release)
      void draw()
    })
    resize.observe(root.value)
  } catch { if (!stopped) { failed.value = true; loading.value = false } }
})
onBeforeUnmount(() => {
  stopped = true
  observer?.disconnect()
  resize?.disconnect()
  renderTask?.cancel()
  nearby.forEach(release)
  nearby.clear()
  void task?.destroy()
})
</script>

<template>
  <div ref="root" class="files-pdf" role="region" :aria-label="title" :aria-busy="loading">
    <p v-if="loading" class="changes-notice" role="status">{{ t('Loading PDF…') }}</p>
    <p v-if="failed" class="changes-notice error" role="alert">{{ t('Could not preview this PDF. Use Open to view it.') }}</p>
    <div v-for="page in count" :key="page" class="pdf-page" :data-page="page" :style="{ aspectRatio: `1 / ${ratio}` }" role="img" :aria-label="`${t('Page')} ${page}`" />
  </div>
</template>
