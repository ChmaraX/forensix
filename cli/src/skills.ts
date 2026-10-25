import { ForensixError } from "@forensix/core";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError } from "./cli-error.js";

/**
 * The agent skill. Its source is `skills/forensix/` at the repository root,
 * where skill installers (`npx skills add`, `gh skill install`, the Claude
 * plugin marketplace) look for it. The build copies it next to the compiled
 * CLI (`dist/skill/forensix`), so these commands work offline from an
 * installed package:
 *
 * - `skill get [name]` prints `SKILL.md`, or one reference file;
 * - `skill list` names them;
 * - `skill install [--dir]` copies the folder into an agent's skills directory;
 * - every other command warns once on stderr when an installed copy differs
 *   from the bundled one.
 */

export const SKILL_NAME = "forensix";
const REFERENCE_NAME = /^[a-z][a-z0-9-]*$/;

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
}

export interface Skill extends SkillSummary {
  readonly content: string;
}

export function skillDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "skill", SKILL_NAME);
}

function bundledFile(relativePath: string): string {
  const path = join(skillDirectory(), relativePath);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new CliError(
      "SKILLS_UNAVAILABLE",
      "The bundled skill files are missing from this installation.",
      { skillDirectory: skillDirectory() },
    );
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Reads `name` and `description` from the YAML front matter. Supports
 *  plain, quoted, and folded (`>` / `|`) one-key-per-line values. */
export function frontMatter(content: string): Readonly<Record<string, string>> {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  const values: Record<string, string> = {};
  let blockKey: string | undefined;
  const block: string[] = [];
  const closeBlock = (): void => {
    if (blockKey !== undefined) {
      values[blockKey] = block.join(" ").trim();
      blockKey = undefined;
      block.length = 0;
    }
  };
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") {
      break;
    }
    if (blockKey !== undefined && /^\s+\S/.test(line)) {
      block.push(line.trim());
      continue;
    }
    closeBlock();
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const [, key = "", value = ""] = match;
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      blockKey = key;
      continue;
    }
    values[key] = unquote(value);
  }
  closeBlock();
  return values;
}

function referenceNames(): string[] {
  let files: string[];
  try {
    files = readdirSync(join(skillDirectory(), "references"));
  } catch {
    return [];
  }
  return files
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .filter((name) => REFERENCE_NAME.test(name))
    .sort();
}

/** The first `# ` heading of a reference file, used as its description. */
function headingOf(content: string): string {
  const line = content.split(/\r?\n/).find((entry) => entry.startsWith("# "));
  return line === undefined ? "" : line.slice(2).trim();
}

/** `SKILL.md` (no name, or `forensix`), or one file of `references/`. */
export function readSkill(name: string | undefined): Skill {
  if (name === undefined || name === SKILL_NAME) {
    const content = bundledFile("SKILL.md");
    const meta = frontMatter(content);
    return {
      name: meta.name ?? SKILL_NAME,
      description: meta.description ?? "",
      content,
    };
  }
  const names = referenceNames();
  if (!REFERENCE_NAME.test(name) || !names.includes(name)) {
    throw new ForensixError("INVALID_ARGUMENT", `Unknown skill: ${name}`, {
      name,
      allowed: [SKILL_NAME, ...names],
    });
  }
  const content = bundledFile(join("references", `${name}.md`));
  return { name, description: headingOf(content), content };
}

export function listSkills(): SkillSummary[] {
  return [undefined, ...referenceNames()].map((name) => {
    const skill = readSkill(name);
    return { name: skill.name, description: skill.description };
  });
}

/** Where an agent's skills directory is when `--dir` is not given. */
export const DEFAULT_SKILLS_DIRECTORY = join(".agents", "skills");

/** Copies the bundled skill folder into `<skillsDirectory>/forensix`. */
export function installSkill(skillsDirectory: string): {
  readonly path: string;
  readonly files: readonly string[];
} {
  bundledFile("SKILL.md");
  const target = join(resolve(skillsDirectory), SKILL_NAME);
  try {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(skillDirectory(), target, { recursive: true });
  } catch (error) {
    throw new CliError(
      "SKILLS_UNAVAILABLE",
      "The skill could not be installed in that directory.",
      {
        skillsDirectory: resolve(skillsDirectory),
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return {
    path: target,
    files: ["SKILL.md", ...referenceNames().map((n) => `references/${n}.md`)],
  };
}

/** The skill text after its front matter: installers may add metadata
 *  (for example `gh skill` provenance) to the front matter only. */
function body(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(content);
  return (match === null ? content : content.slice(match[0].length)).replace(
    /\r\n/g,
    "\n",
  );
}

/** The installed copies, project and user scope, of the common agents. */
function installedCopies(): string[] {
  const roots = [process.cwd(), homedir()];
  const directories = [
    join(".agents", "skills"),
    join(".claude", "skills"),
    join(".codex", "skills"),
    join(".cursor", "skills"),
  ];
  return [
    ...new Set(
      roots.flatMap((root) =>
        directories.map((directory) => join(root, directory, SKILL_NAME)),
      ),
    ),
  ];
}

/**
 * The installed copies whose text differs from the bundled skill. A copy that
 * is a link to the bundled folder, or that differs only in front matter, is
 * current. Errors read as "not installed": the check never fails a command.
 */
export function outdatedSkillCopies(): string[] {
  let bundled: Readonly<Record<string, string>>;
  try {
    const files = [
      "SKILL.md",
      ...referenceNames().map((name) => join("references", `${name}.md`)),
    ];
    bundled = Object.fromEntries(
      files.map((file) => [
        file,
        body(readFileSync(join(skillDirectory(), file), "utf8")),
      ]),
    );
  } catch {
    return [];
  }
  const bundledReal = (() => {
    try {
      return realpathSync(skillDirectory());
    } catch {
      return skillDirectory();
    }
  })();
  // One entry per real folder: the current and home directories can be the
  // same folder under two spellings.
  const copies = new Set<string>();
  for (const copy of installedCopies()) {
    try {
      if (existsSync(join(copy, "SKILL.md"))) copies.add(realpathSync(copy));
    } catch {
      // Unreadable: treated as not installed.
    }
  }
  return [...copies].filter((copy) => {
    try {
      if (copy === bundledReal) return false;
      return Object.entries(bundled).some(([file, text]) => {
        const installed = join(copy, file);
        return (
          !existsSync(installed) ||
          body(readFileSync(installed, "utf8")) !== text
        );
      });
    } catch {
      return false;
    }
  });
}
