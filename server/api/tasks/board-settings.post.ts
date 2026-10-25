// Change one board setting: { machine, name, value } (`set`) or { machine, name,
// unset: true } (`unset`), with `repo` for that repo's entry. Answers with the
// settings read again afterwards.
import { changeBoardSetting } from '../../utils/projectsTasks'

export default defineApi((_event, b) => changeBoardSetting(b.machine ?? '', b))
