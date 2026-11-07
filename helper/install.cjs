'use strict';
// Explicit setup only. The plugin/launcher never installs packages silently at sign-in.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) { console.error('Node.js 22.12+ is required.'); process.exit(1); }
const root = path.dirname(require.resolve('electron/package.json'));
// Electron v44 lazily downloads on first require. Running its install entry is explicit here.
const result = spawnSync(process.execPath, [path.join(root, 'install.js')], { stdio: 'inherit', env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '' } });
if (result.status !== 0) process.exit(result.status || 1);
const relative = fs.readFileSync(path.join(root, 'path.txt'), 'utf8').trim();
if (!fs.existsSync(path.join(root, 'dist', relative))) throw new Error('Electron binary installation failed');
console.log('Qishui SDK helper dependencies are installed. No account data was accessed.');
