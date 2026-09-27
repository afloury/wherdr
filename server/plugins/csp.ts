import { cspForHtml } from '../utils/csp'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, context) => {
    if (typeof response.body !== 'string' || !response.body.includes('<html')) return
    response.headers = { ...response.headers, 'content-security-policy': cspForHtml(response.body, context.event.node.req.headers.host || '') }
  })
})
