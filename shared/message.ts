// Messages produced on the server and shown in the app. They are written in
// English; the client translates them with t() (app/utils/i18n.ts). A message
// with variable parts is a template with {name} placeholders, filled here:
// the template is the dictionary key, so t() can translate the filled text
// back by matching it against the template.
export function fmt(template: string, params: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (params[k] == null ? all : String(params[k])))
}
