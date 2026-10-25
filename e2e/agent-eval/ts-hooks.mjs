/**
 * Lets plain Node (type stripping, no vitest) import the e2e TypeScript files.
 * Those files import siblings as `./x.js` (the NodeNext style that vitest
 * resolves). Node does not map `.js` to `.ts`, so this hook retries a failed
 * relative `.js` import from a `.ts` parent as `.ts`.
 */
import { registerHooks } from "node:module";

/** Marks repo `.ts` files as ES modules (the root package has no `type`). */
function asModule(result) {
  return result.url.endsWith(".ts") && !result.url.includes("/node_modules/")
    ? { ...result, format: "module-typescript" }
    : result;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return asModule(nextResolve(specifier, context));
    } catch (error) {
      const fromTs = context.parentURL?.endsWith(".ts") ?? false;
      if (fromTs && specifier.startsWith(".") && specifier.endsWith(".js")) {
        return asModule(nextResolve(`${specifier.slice(0, -3)}.ts`, context));
      }
      throw error;
    }
  },
});
