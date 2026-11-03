// coordinator.md is inlined as text by the build (esbuild --loader:.md=text).
declare module '*.md' {
  const text: string
  export default text
}
