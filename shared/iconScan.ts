// Files scanned for icon names to bundle (nuxt.config.ts). The default scan of
// @nuxt/icon skips .ts files, so an icon named only in a composable or a util
// was missing at runtime ("failed to load icon").
export const ICON_SCAN_GLOBS = ['app/**/*.{vue,ts}', 'shared/**/*.ts']
