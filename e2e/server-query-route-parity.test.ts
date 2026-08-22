// E2E runs the built public package entry points, not source files.
import * as core from "../core/dist/index.js";
import { API_ROUTES } from "../server/dist/index.js";
import { expect, it } from "vitest";

const CLI_ONLY_CORE_QUERIES = new Set<string>([
  // Add intentionally CLI-only exported query functions here, with a reason.
]);

function routeNameForCoreQuery(queryName: string): string {
  return queryName
    .slice("query".length)
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^-/, "");
}

it("registers a server route for every non-CLI core query", () => {
  const coreQueryFunctions = Object.entries(core)
    .filter(
      ([name, exported]) =>
        name.startsWith("query") && typeof exported === "function",
    )
    .map(([name]) => name);
  const registeredRouteNames = new Set(API_ROUTES.keys());

  const missingRoutes = coreQueryFunctions
    .filter((name) => !CLI_ONLY_CORE_QUERIES.has(name))
    .map(routeNameForCoreQuery)
    .filter((routeName) => !registeredRouteNames.has(routeName));

  expect(missingRoutes).toEqual([]);
});
