// Read by every web-ext command run from here; keeps dev files out of the signed add-on.
module.exports = {
  ignoreFiles: [
    "AGENTS.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "web-ext-config.cjs",
    "node_modules",
    "tests",
    "test-results",
  ],
};
