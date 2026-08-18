/**
 * Let a plain Node script import this repo's `.ts` modules the way Vite does.
 *
 * Node ≥ 22.18 strips types from a `.ts` file happily enough — that is what
 * `scripts/test-content-schema.mjs` already relies on. What it does not do is
 * resolve an **extensionless** specifier: `import { site } from './site'` is a
 * bundler convention, and Node ESM requires the extension.
 *
 * The two obvious fixes are both worse than this file:
 *
 *   - Write `./site.ts` in the source. TypeScript rejects a `.ts` extension in
 *     an import unless `allowImportingTsExtensions` is on, and turning that on
 *     to make a test runnable is a compiler setting changed for a reason that
 *     has nothing to do with the compiler.
 *   - Give the tests their own copies of the modules. That is the thing tests
 *     exist to prevent.
 *
 * So: a resolve hook that appends `.ts` to a relative specifier that has no
 * extension and no file of its own, and defers to Node for everything else. It
 * is registered by `scripts/test-ai.mjs` before its dynamic imports run.
 *
 * Deliberately narrow. It only touches specifiers beginning `./` or `../`, only
 * when they have no extension at all, and only when the `.ts` file actually
 * exists — so a genuine missing-module error is still a missing-module error
 * naming the right specifier, rather than one naming a `.ts` path nobody wrote.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `./site` yes; `./site.ts`, `./data.json`, `astro`, `node:fs` all no. */
const isBareRelative = specifier =>
  /^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier);

export async function resolve(specifier, context, nextResolve) {
  if (isBareRelative(specifier) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(`${specifier}.ts`, context);
    }
  }
  return nextResolve(specifier, context);
}
