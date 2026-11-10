// Error kinds the API answers with ({ error, code }, see http.ts), and a sleep helper.
export class HerdrError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
