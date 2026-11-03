// wherdr.files.read of a plugin (docs/plugins.md): a text file of a project folder, herdr-core only.
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { pluginReadFile } from '../../utils/pluginFiles'

export default defineApi((event, b) => {
  if (process.env.WHERDR_BACKEND !== 'core') throw new HerdrError('unavailable', 'Needs herdr-core')
  return pluginReadFile(coreAdminDeps(), b)
})
