// What a terminal relay needs from a WebSocket (crossws or other), and what it
// gives back (see coreTerm.ts).
export interface WsLike {
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  isOpen: () => boolean
}

export interface TermSession {
  onMessage: (raw: string) => void
  // `clean`: closed on purpose by the client (not a dropped connection).
  onClose: (clean?: boolean) => void
}
