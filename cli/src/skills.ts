import { ForensixError } from "@forensix/core";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError } from "./cli-error.js";

/**
 * The bundled agent guides: `<package>/skills/<name>.md`, resolved next to the
 * compiled CLI (`dist/cli.js` -> `../skills`), so they work from the source
 * tree and from an installed package. A local file read only: no network.
 */

/** The guides in reading order; other files in the directory sort after. */
const SKILL_ORDER = ["core", "acquire", "investigate", "report"];
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
}

export interface Skill extends SkillSummary {
  readonly content: string;
}

export function skillsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
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

function availableNames(): string[] {
  let files: string[];
  try {
    files = readdirSync(skillsDirectory());
  } catch {
    throw new CliError(
      "SKILLS_UNAVAILABLE",
      "The bundled skill files are missing from this installation.",
      { skillsDirectory: skillsDirectory() },
    );
  }
  const names = files
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .filter((name) => SKILL_NAME.test(name));
  const rank = (name: string): number => {
    const index = SKILL_ORDER.indexOf(name);
    return index === -1 ? SKILL_ORDER.length : index;
  };
  return names.sort(
    (left, right) => rank(left) - rank(right) || left.localeCompare(right),
  );
}

export function readSkill(name: string): Skill {
  const names = availableNames();
  if (!SKILL_NAME.test(name) || !names.includes(name)) {
    throw new ForensixError("INVALID_ARGUMENT", `Unknown skill: ${name}`, {
      name,
      allowed: names,
    });
  }
  const content = readFileSync(join(skillsDirectory(), `${name}.md`), "utf8");
  const meta = frontMatter(content);
  return {
    name: meta.name ?? name,
    description: meta.description ?? "",
    content,
  };
}

export function listSkills(): SkillSummary[] {
  return availableNames().map((name) => {
    const skill = readSkill(name);
    return { name: skill.name, description: skill.description };
  });
}
