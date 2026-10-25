import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The agent skill lives at the repository root (skills/forensix), where skill
// installers look for it. The CLI bundles a copy so `forensix skill get` and
// `forensix skill install` work offline from an installed package.
const source = fileURLToPath(new URL("../../skills/forensix", import.meta.url));
const destination = fileURLToPath(
  new URL("../dist/skill/forensix", import.meta.url),
);

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
