// Bound both polling work and actual pane.read RPCs (including background
// model/activity reads). These are distinct budgets so nested reads cannot
// deadlock. Neither budget borrows SSH command/stream slots.
export const SCREEN_MACHINE_MAX = 2
export const SCREEN_TOTAL_MAX = 4

export class ScreenGate {
  private active = 0
  private background = 0
  private backgroundMachines = new Map<string, number>()
  private machines = new Map<string, number>()
  priority: (machine: string, pane: unknown) => boolean = () => false
  reserved: (machine?: string) => boolean = () => false
  private queue: { machine: string, pane: unknown, start: () => void }[] = []

  run<T>(machine: string, work: () => Promise<T>, pane?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ machine, pane, start: () => {
        const background = !this.priority(machine, pane)
        if (background) { this.background++; this.backgroundMachines.set(machine, (this.backgroundMachines.get(machine) || 0) + 1) }
        this.active++
        this.machines.set(machine, (this.machines.get(machine) || 0) + 1)
        Promise.resolve().then(work).then(resolve, reject).finally(() => {
          if (background) {
            this.background--
            const n = this.backgroundMachines.get(machine)! - 1
            if (n) this.backgroundMachines.set(machine, n)
            else this.backgroundMachines.delete(machine)
          }
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
      const eligible = (q: typeof this.queue[number]) => {
        const active = this.machines.get(q.machine) || 0
        return active < SCREEN_MACHINE_MAX && (this.priority(q.machine, q.pane)
          || ((this.backgroundMachines.get(q.machine) || 0) < SCREEN_MACHINE_MAX - Number(this.reserved(q.machine))
            && this.background < SCREEN_TOTAL_MAX - Number(this.reserved())))
      }
      const first = this.queue.findIndex(q => eligible(q) && this.priority(q.machine, q.pane))
      const i = first < 0 ? this.queue.findIndex(eligible) : first
      if (i < 0) return
      this.queue.splice(i, 1)[0]!.start()
    }
  }
}

const workGate = new ScreenGate()
export const screenRpcGate = new ScreenGate()
export async function mapScreenPanes<T>(panes: T[], machine: string, work: (pane: T, index: number) => Promise<void>, viewed: (pane: T) => boolean, publish?: (pane: T) => void) {
  const order = panes.map((pane, index) => ({ pane, index }))
    .sort((a, b) => Number(viewed(b.pane)) - Number(viewed(a.pane)))
  await Promise.all(order.map(({ pane, index }) => workGate.run(machine, async () => {
    await work(pane, index)
    if (viewed(pane)) publish?.(pane)
  })))
}
