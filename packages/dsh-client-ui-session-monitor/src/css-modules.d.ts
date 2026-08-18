declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.html' {
  const html: string
  export default html
}
