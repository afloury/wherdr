// Network first, without hanging on a server that accepts the connection but
// never answers (a phone on a tailnet whose wherdr host is gone: the request
// stays open for minutes, the installed app shows a blank screen). Past
// `waitMs`, the cached copy is served; the request carries on and its answer
// still refreshes the cache (sw.ts). A network error serves the cached copy at
// once. Nothing cached, or the cache unreadable: the server's answer, however late.
export async function networkFirst(
  network: Promise<Response>,
  cached: () => Promise<Response | undefined>,
  waitMs: number,
): Promise<Response> {
  const answer = network.catch(() => null)
  // Executor form: Promise.withResolvers needs iOS 17.4, the app supports 16.4.
  const late = new Promise<undefined>((resolve) => {
    const timer = setTimeout(resolve, waitMs)
    void answer.then(() => clearTimeout(timer))
  })
  const first = await Promise.race([answer, late])
  if (first) return first
  return (await cached().catch(() => undefined)) || (await answer) || Response.error()
}
