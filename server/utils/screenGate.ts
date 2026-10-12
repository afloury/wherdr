// Bound both polling work and actual pane.read RPCs (including background
// model/activity reads). These are distinct budgets so nested reads cannot
// deadlock. Neither budget borrows SSH command/stream slots.
export const SCREEN_MACHINE_MAX = 2
export const SCREEN_TOTAL_MAX = 4

export class ScreenGate {
  private active = 0
  private machines = new Map<string, number>()
  private queue: { machine: string, start: () => void }[] = []

  run<T>(machine: string, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ machine, start: () => {
        this.active++
        this.machines.set(machine, (this.machines.get(machine) || 0) + 1)
        Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--
          const remaining = this.machines.get(machine)! - 1
          if (remaining) this.machines.set(machine, remaining)
          else this.machines.delete(machine)
          this.drain()
        })
      } })
      this.drain()
    })
  }

  private drain() {
    while (this.active < SCREEN_TOTAL_MAX) {
      const i = this.queue.findIndex(q => (this.machines.get(q.machine) || 0) < SCREEN_MACHINE_MAX)
      if (i < 0) return
      this.queue.splice(i, 1)[0]!.start()
    }
  }
}

const workGate = new ScreenGate()
export const screenRpcGate = new ScreenGate()
export async function mapScreenPanes<T>(panes: T[], machine: string, work: (pane: T, index: number) => Promise<void>, viewed: (pane: T) => boolean) {
  const order = panes.map((pane, index) => ({ pane, index }))
    .sort((a, b) => Number(viewed(b.pane)) - Number(viewed(a.pane)))
  await Promise.all(order.map(({ pane, index }) => workGate.run(machine, () => work(pane, index))))
}
