module.exports = {
  forbidden: [
    {
      name: "core-does-not-import-adapters",
      comment:
        "Analyzer core owns forensic logic and cannot depend on adapters.",
      severity: "error",
      from: { path: "^core/src" },
      to: { path: "^(cli|server|client)/src" },
    },
    {
      name: "core-does-not-import-interface-frameworks",
      comment: "Analyzer core has no HTTP or React dependency.",
      severity: "error",
      from: { path: "^core/src" },
      to: { path: "^(hono|react)(/|$)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
