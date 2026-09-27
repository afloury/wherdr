// Autre chemin sous /ws/ : refusé, comme avant.
export default defineWebSocketHandler({
  upgrade: () => new Response(null, { status: 403, statusText: 'Forbidden' }),
})
