// Machine bar of the home list (utils/machineBar.ts): its settings and the
// current choice. The home list's machine order (server side,
// /api/machine/order) lives here too: the bar and its settings list follow it
// for the machines they do not place.
import { boardTabChoice } from '~/utils/boardScope'
import { sortMachines } from '#shared/machineOrder'
import { flag, syncedRef } from './useSyncedSettings'
import { BAR_ALL, groupedBarItems, barMachineSelection, barPick, readBarList, readBarPick, readMachineGroups, setBarItemShown } from '~/utils/machineBar'

const store = {
  get(k: string) { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

// The bar's settings and the groups follow the user across devices (kept on
// the server, useSyncedSettings.ts); the item last tapped stays on the device.
export const machineBarOn = syncedRef('machineBar', flag.read(true), flag.write)
export const machineBarOrder = syncedRef<string[]>('machineBarOrder', readBarList, v => JSON.stringify(v), { deep: true })
export const machineBarHidden = syncedRef<string[]>('machineBarHidden', readBarList, v => JSON.stringify(v), { deep: true })
// The item last tapped (BAR_ALL, a group's ID, or a machine's base key).
export const machineBarSaved = ref<string | null>(readBarPick(store.get('machineBarPick')))
watch(machineBarSaved, v => store.set('machineBarPick', JSON.stringify(v)))

export const machineGroups = syncedRef('machineGroups', readMachineGroups, v => JSON.stringify(v), { deep: true })

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
export const machineBarItems = computed(() => groupedBarItems(machineBarOrder.value, barMachines.value, machineGroups.value)
  .map(id => ({ id, shown: !machineBarHidden.value.includes(id) })))
// The bar shows by default, a single machine included ("All", then that machine).
export const machineBarShown = computed(() => (machineBarOn.value
  ? machineBarItems.value.filter(x => x.shown).map(x => x.id)
  : []))
export const machineBarPick = computed(() => barPick(machineBarSaved.value, machineBarShown.value))
// Track tab changes even while the Board is closed: returning to a previous
// tab starts from that tab's scope rather than an earlier manual choice.
watch(machineBarPick, pick => boardTabChoice.followTab(pick), { immediate: true, flush: 'sync' })
// Ordered base keys shown by the selection, or null for every machine.
export const machineBarSelection = computed(() => barMachineSelection(machineBarPick.value, machineGroups.value))
export function pickMachineBar(id: string) {
  machineBarSaved.value = id
}
// A conversation opened from outside the list (a remote coordinator link):
// its machine's bar item becomes current, shown again if hidden, as if the
// conversation had been opened from the list.
export function showMachineInBar(machine: string) {
  const base = machineInfo(machine)?.baseKey ?? machine
  const only = machineBarSelection.value
  if (only === null || only.includes(base) || !machineBarItems.value.some(x => x.id === base)) return
  if (machineBarHidden.value.includes(base)) machineBarHidden.value = setBarItemShown(machineBarHidden.value, base, true)
  pickMachineBar(base)
  const keys = machines.value.filter(m => (m.baseKey ?? m.key) === base).map(m => m.key)
  if (keys.some(k => collapsedMachines.value.includes(k))) collapsedMachines.value = collapsedMachines.value.filter(k => !keys.includes(k))
}
export function resetMachineBar() {
  machineBarOrder.value = []
  machineBarHidden.value = []
  machineBarSaved.value = BAR_ALL
}
