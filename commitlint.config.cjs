/**
 * Conventional Commits enforcement for ForensiX v2.
 *
 * Applies to local commit messages (via the husky commit-msg hook) and to PR
 * titles (via the commitlint-pr-title CI job) because squash-merge promotes the
 * PR title to the commit that lands on the integration branch.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
};
