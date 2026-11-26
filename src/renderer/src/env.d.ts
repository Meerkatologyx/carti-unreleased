/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __COMMIT_HASH__: string
declare const __BRANCH_NAME__: string

declare module '*.png' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}

/** Current app route path, without the GitHub Pages sub-path (lib/basePath.ts). */
declare function appPathname(): string
