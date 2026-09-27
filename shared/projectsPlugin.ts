export const PROJECTS_REPO = 'eliasstravik/herdr-projects'
export const PROJECTS_INSTALL_ARGS = ['plugin', 'install', PROJECTS_REPO, '--yes'] as const
export const PROJECTS_COMMAND = `herdr ${PROJECTS_INSTALL_ARGS.join(' ')}`
