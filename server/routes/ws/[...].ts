// Any other path under /ws/: refused, as before.
export default defineWebSocketHandler({
  upgrade: () => new Response(null, { status: 403, statusText: 'Forbidden' }),
})
