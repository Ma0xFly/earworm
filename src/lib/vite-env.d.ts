/// <reference types="vite/client" />

// Vite returns the compiled CSS text for `?inline` imports; this is how the
// content entrypoint feeds Tailwind CSS into the shadow root.
declare module '*.css?inline' {
  const css: string;
  export default css;
}
