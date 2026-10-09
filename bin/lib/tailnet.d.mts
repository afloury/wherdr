// Types of tailnet.mjs, for the server (server/utils/phone.ts).
// funnel: also published on the Internet by `tailscale funnel` (never adopted).
export interface PhoneAddress { url: string, served: boolean, httpsPort: string, funnel?: boolean }
export interface Tailnet {
  installed: boolean
  bin?: string | null
  // Tailscale's socket, when the state was read there (no CLI: Docker).
  socket?: string | null
  name?: string | null
  connected?: boolean
  https?: boolean
  phone?: PhoneAddress | null
  taken?: boolean
  // Addresses published for wherdr's port; null when they could not be read.
  served?: string[] | null
}
export type Reach = 'ok' | 'host' | 'other' | 'unreachable'
export type ReachCause = 'dns' | 'refused' | 'timeout' | 'cert' | 'tls' | 'network'
export interface Probe { reach: Reach, cause?: ReachCause, status?: number }
export type ServeErrorCode = 'operator' | 'https' | 'offline'

export const LINKS: { download: string, https: string, operator: string }
export const TAILSCALED_SOCKET: string
export function tailscaledSocket(env?: Record<string, string | undefined>, exists?: (p: string) => boolean): string | null
export function tailscaleBin(env?: Record<string, string | undefined>, exists?: (p: string) => boolean): string | null
export function tailnetStatus(statusJson: string): { name: string | null, connected: boolean, https: boolean }
export function phoneAddress(name: string | null, port: string | number, serveJson: string): PhoneAddress | null
export function servedAddresses(name: string | null, port: string | number, serveJson: string): string[] | null
export function servedPorts(serveJson: string): string[]
export function publishCommand(port: string | number, httpsPort?: string | number): string
export function publishArgs(port: string | number): string[]
export function unpublishArgs(httpsPort: string): string[]
export function tailnetUrl(text: unknown): string | null
export function serveError(output: string): { code: ServeErrorCode, link: string } | null
export function inspect(port: string | number, bin?: string | null, socket?: string | null): Promise<Tailnet>
export function tailnetDomain(resolvConf: string): string | null
export function reachable(url: string, timeoutMs?: number): Promise<Reach>
export function probe(url: string, timeoutMs?: number): Promise<Probe>
export function failureCause(err: unknown): ReachCause
export function runTailscale(bin: string, args: string[], timeoutMs?: number): Promise<{ code: number, output: string }>
