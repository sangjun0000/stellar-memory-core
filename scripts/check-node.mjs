#!/usr/bin/env node
/**
 * check-node.mjs — Preinstall script that validates Node.js version.
 * Runs before `npm install` via the "preinstall" hook in package.json.
 */

const REQUIRED_MAJOR = 22;

const [major] = process.versions.node.split('.').map(Number);

if (major < REQUIRED_MAJOR) {
  console.error(`
╔══════════════════════════════════════════════════════════════╗
║              Stellar Memory — Node.js Version Error          ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Required:  Node.js 22 or higher                             ║
║  Detected:  Node.js ${process.versions.node.padEnd(40)}║
║                                                              ║
║  Stellar Memory uses the built-in node:sqlite module which   ║
║  was introduced in Node.js 22. It will not work on older     ║
║  versions.                                                   ║
║                                                              ║
║  How to upgrade:                                             ║
║                                                              ║
║  Option A — nvm (recommended):                               ║
║    nvm install 22                                            ║
║    nvm use 22                                                ║
║                                                              ║
║  Option B — Direct download:                                 ║
║    https://nodejs.org/en/download                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}
