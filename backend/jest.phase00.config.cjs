const { resolve } = require('node:path');
const existing = require('./jest.config.js');

module.exports = {
  ...existing,
  rootDir: __dirname,
  // Behavioral tests transpile each file once; run tsc separately for type
  // diagnostics instead of repeatedly checking the entire Prisma/service graph.
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
  setupFiles: [...(existing.setupFiles || []), resolve(__dirname, '../scripts/phase00/offline.cjs')],
};
