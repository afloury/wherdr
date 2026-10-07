// Types of tailnet.mjs, for the server (server/utils/phone.ts).
export interface PhoneAddress { url: string, served: boolean, httpsPort: string }
export interface Tailnet {
  installed: boolean
  bin?: string
  name?: string | null
  connected?: boolean
  https?: boolean
  phone?: PhoneAddress | null
  taken?: boolean
}
export type Reach = 'ok' | 'host' | 'other' | 'unreachable'
export type ServeErrorCode = 'operator' | 'https' | 'offline'

export const LINKS: { download: string, https: string, operator: string }
export function tailscaleBin(env?: Record<string, string | undefined>, exists?: (p: string) => boolean): string | null
export function tailnetStatus(statusJson: string): { name: string | null, connected: boolean, https: boolean }
export function phoneAddress(name: string | null, port: string | number, serveJson: string): PhoneAddress | null
export function servedPorts(serveJson: string): string[]
export function publishCommand(port: string | number): string
export function publishArgs(port: string | number): string[]
export function unpublishArgs(httpsPort: string): string[]
export function tailnetUrl(text: unknown): string | null
export function serveError(output: string): { code: ServeErrorCode, link: string } | null
export function inspect(port: string | number, bin?: string | null): Promise<Tailnet>
export function tailnetDomain(resolvConf: string): string | null
export function reachable(url: string, timeoutMs?: number): Promise<Reach>
export function runTailscale(bin: string, args: string[], timeoutMs?: number): Promise<{ code: number, output: string }>
