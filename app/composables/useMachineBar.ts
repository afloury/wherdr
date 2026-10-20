// Machine bar of the home list (utils/machineBar.ts): its settings and the
// current choice, kept on the device like the other home screen settings. The
// home list's machine order (server side, /api/machine/order) lives here too:
// the bar and its settings list follow it for the machines they do not place.
import { sortMachines } from '#shared/machineOrder'
import { BAR_ALL, barFilter, barItems, barPick, barShown, readBarList, readBarPick } from '~/utils/machineBar'

const store = {
  get(k: string) { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

export const machineBarOn = ref(store.get('machineBar') !== '0')
watch(machineBarOn, v => store.set('machineBar', v ? '1' : '0'))
export const machineBarOrder = ref<string[]>(readBarList(store.get('machineBarOrder')))
watch(machineBarOrder, v => store.set('machineBarOrder', JSON.stringify(v)))
export const machineBarHidden = ref<string[]>(readBarList(store.get('machineBarHidden')))
watch(machineBarHidden, v => store.set('machineBarHidden', JSON.stringify(v)))
// The item last tapped (BAR_ALL, or a machine's base key).
export const machineBarSaved = ref<string | null>(readBarPick(store.get('machineBarPick')))
watch(machineBarSaved, v => store.set('machineBarPick', JSON.stringify(v)))

// ------------------------------------------------------------ machine order
export const machineOrder = ref<string[]>([])
let orderLoad = 0
export async function loadMachineOrder() {
  const request = ++orderLoad
  try {
    const { order } = await api<{ order: string[] }>('/api/machine/order')
    if (request === orderLoad) machineOrder.value = order
  }
  catch { /* Herdr's order stays available offline. */ }
}
export async function saveMachineOrder(order: string[]) {
  ++orderLoad
  const previous = machineOrder.value
  machineOrder.value = order
  try { machineOrder.value = (await api<{ order: string[] }>('/api/machine/order', { order })).order }
  catch (err) { machineOrder.value = previous; toast((err as Error).message, true) }
}

// Machines in the home list's order, and their base keys (a named session
// counts as its machine).
export const orderedMachines = computed(() => sortMachines(machines.value, machineOrder.value))
export const machineBaseKeys = computed(() => [...new Set(orderedMachines.value.map(m => m.baseKey ?? m.key))])
// The machines the bar offers: with a single machine Herdr's state may list
// none, and that machine is the local one ('').
const barMachines = computed(() => (machineBaseKeys.value.length ? machineBaseKeys.value : ['']))

// ------------------------------------------------------------ the bar
// Settings list: every item, in order, with whether the bar shows it.
export const machineBarItems = computed(() => barItems(machineBarOrder.value, barMachines.value)
  .map(id => ({ id, shown: !machineBarHidden.value.includes(id) })))
// The bar shows by default, a single machine included ("All", then that machine).
export const machineBarShown = computed(() => (machineBarOn.value
  ? barShown(machineBarOrder.value, machineBarHidden.value, barMachines.value)
  : []))
export const machineBarPick = computed(() => barPick(machineBarSaved.value, machineBarShown.value))
// The machine (base key) the home list shows alone, or null for all of them.
export const machineBarFilter = computed(() => barFilter(machineBarPick.value))
export function pickMachineBar(id: string) {
  machineBarSaved.value = id
}
export function resetMachineBar() {
  machineBarOrder.value = []
  machineBarHidden.value = []
  machineBarSaved.value = BAR_ALL
}
