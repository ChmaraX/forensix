import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../contracts", import.meta.url));
const destination = fileURLToPath(
  new URL("../dist/contracts", import.meta.url),
);

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
