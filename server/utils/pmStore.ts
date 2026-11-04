// Project management storage, in DATA_DIR/projects/ (one engine, on the wherdr
// host): pm.json (the on/off switch), projects.json, templates/<id>.json.
// Atomic writes (temp file + rename), one at a time. Switched off, every
// write is refused except turning it back on.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { cleanProjectInput, isTemplateId, type PmOverview, type Project, type TemplateInfo } from '../../shared/pm/project'
import { validateTemplate, type Template } from '../../shared/pm/workflow'
import { HerdrError } from './herdr'
import { DATA_DIR } from './env'

// The checks the store cannot make itself: the machine, a git folder there.
// Resolves to the folder's absolute path.
export type FolderCheck = (machine: string, folder: string) => Promise<string>

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

const badInput = (errors: { path: string, message: string }[]) =>
  new HerdrError('bad_input', errors.map(e => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; '))

export function createPmStore(dir = path.join(DATA_DIR, 'projects')) {
  const files = { pm: path.join(dir, 'pm.json'), projects: path.join(dir, 'projects.json'), templates: path.join(dir, 'templates') }
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn)
    queue = run.catch(() => {})
    return run
  }

  const enabled = async () => (await readJson<{ enabled?: boolean }>(files.pm))?.enabled === true
  const projects = async () => (await readJson<{ projects?: Project[] }>(files.projects))?.projects ?? []
  async function templates(): Promise<TemplateInfo[]> {
    const names = await fs.readdir(files.templates).catch(() => [] as string[])
    const out: TemplateInfo[] = []
    for (const n of names.filter(n => n.endsWith('.json')).sort()) {
      const t = await readJson<Template>(path.join(files.templates, n)).catch(() => null)
      if (t && isTemplateId(t.id) && `${t.id}.json` === n) out.push({ id: t.id, ...(t.version !== undefined ? { version: t.version } : {}) })
    }
    return out
  }
  // Every write but the switch goes through here.
  const write = <T>(fn: () => Promise<T>) => serial(async () => {
    if (!await enabled()) throw new HerdrError('pm_off', 'Projects are switched off')
    return fn()
  })
  const saveProjects = (list: Project[]) => writeJson(files.projects, { v: 1, projects: list })
  async function findProject(key: unknown) {
    const list = await projects()
    const i = list.findIndex(p => p.key === key)
    if (i < 0) throw new HerdrError('not_found', 'Unknown project')
    return { list, i }
  }
  async function knownTemplate(id: string | undefined) {
    if (id && !(await templates()).some(t => t.id === id)) throw new HerdrError('not_found', 'Unknown template')
  }

  return {
    files,
    async overview(): Promise<PmOverview> {
      return { enabled: await enabled(), projects: await projects(), templates: await templates() }
    },
    setEnabled: (on: boolean) => serial(() => writeJson(files.pm, { v: 1, enabled: on })),

    addProject: (raw: unknown, check: FolderCheck) => write(async () => {
      const { project, errors } = cleanProjectInput(raw)
      if (!project) throw badInput(errors)
      const list = await projects()
      if (list.some(p => p.key === project.key)) throw new HerdrError('exists', 'A project already has this key')
      await knownTemplate(project.template)
      const folder = await check(project.machine, project.path)
      if (list.some(p => p.machine === project.machine && p.path === folder)) throw new HerdrError('exists', 'This folder is already a project')
      const added: Project = { ...project, path: folder, addedAt: Date.now() }
      await saveProjects([...list, added])
      return added
    }),

    // Picks (or clears, with '') the project's template.
    setTemplate: (key: unknown, template: unknown) => write(async () => {
      const id = typeof template === 'string' ? template : ''
      if (id && !isTemplateId(id)) throw badInput([{ path: 'template', message: 'invalid template id' }])
      await knownTemplate(id || undefined)
      const { list, i } = await findProject(key)
      const { template: _old, ...rest } = list[i]!
      list[i] = id ? { ...rest, template: id } : rest
      await saveProjects(list)
      return list[i]!
    }),

    removeProject: (key: unknown) => write(async () => {
      const { list, i } = await findProject(key)
      list.splice(i, 1)
      await saveProjects(list)
    }),

    saveTemplate: (t: unknown) => write(async () => {
      const errors = validateTemplate(t)
      const id = (t as Template | null)?.id
      if (!errors.length && !isTemplateId(id)) errors.push({ path: 'id', message: 'lowercase letters, digits, . _ -' })
      if (errors.length) throw badInput(errors)
      await writeJson(path.join(files.templates, `${id}.json`), t)
      return { id: id!, ...((t as Template).version !== undefined ? { version: (t as Template).version } : {}) }
    }),
  }
}

export type PmStore = ReturnType<typeof createPmStore>
let store: PmStore | null = null
export const pmStore = () => (store ??= createPmStore())
