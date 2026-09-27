export default defineEventHandler(event => serveBranding(event, `icons/${getRouterParam(event, 'name') || ''}`))
