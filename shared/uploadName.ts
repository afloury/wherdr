// Extension de la copie temporaire : jamais de nom fourni par le navigateur.
export function safeUploadExtension(requested: string) {
  return /^[a-z0-9]{1,10}$/i.test(requested) ? requested.toLowerCase() : 'bin'
}
