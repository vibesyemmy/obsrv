# Obsrv — Claude Code plugin

This branch is generated. It carries the plugin and nothing else — the skill, the
manifests and the MCP registration — so installing it does not copy a development
tree or run `npm install` into your plugin cache.

The source, the app and the CLI live on [`main`](https://github.com/vibesyemmy/obsrv).
The MCP server it registers is the `getobsrv` package on npm, fetched with `npx` at
this same version;
nothing here is the implementation.

Built from `v0.57.0` by `scripts/build-plugin-branch.js`. Do not commit to this
branch by hand — the next release overwrites it.
