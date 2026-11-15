import { listClientPlugins } from '../utils/clientPlugins'

// Installed wherdr plugins (DATA_DIR/plugins), for the page's loader.
export default defineEventHandler(async () => ({ plugins: await listClientPlugins() }))
