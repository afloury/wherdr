// The home list's first load (WHR-329): each section it draws from its own
// read (the quotas, Alfred, the coordinators, the tasks to handle, the task
// agents) marks here when that read first ends, answered or failed. Until all
// have, the list shows skeletons (HomeSkeleton) instead of the sections that happen to be in,
// then draws everything at once. Latched: later refreshes keep the last data.
export const homeFirstLoad = reactive({ alfred: false, coordinators: false, handle: false, agents: false, quotas: false })
export const homeListReady = ref(false)
export const homeSectionsLoaded = () => Object.values(homeFirstLoad).every(Boolean)
// A read that never ends (a lost request) does not hold the skeletons forever.
export const HOME_LOAD_DEADLINE = 10_000
