import { access } from "node:fs/promises";

const CLOUDFLARE_WORKERS_MODULE = "data:text/javascript,export const env = globalThis.__LOL_RIFT_TEST_ENV";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: CLOUDFLARE_WORKERS_MODULE, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!context.parentURL || (!specifier.startsWith(".") && !specifier.startsWith("/"))) throw error;
    const base = new URL(specifier, context.parentURL);
    for (const candidate of [`${base.href}.ts`, `${base.href}.tsx`, `${base.href}/index.ts`]) {
      try {
        await access(new URL(candidate));
        return { url: candidate, shortCircuit: true };
      } catch {
        // Try the next TypeScript ESM resolution candidate.
      }
    }
    throw error;
  }
}
