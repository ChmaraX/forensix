/** Compiled Tailwind CSS, injected by scripts/build.mjs at bundle time. */
declare const __APP_CSS__: string;

/** Images are inlined as `data:` URIs by the bundler; the import is that URI. */
declare module "*.png" {
  const dataUri: string;
  export default dataUri;
}
