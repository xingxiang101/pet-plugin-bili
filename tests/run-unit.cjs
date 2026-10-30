'use strict';
// Enumerate explicitly: Windows cmd does not expand the POSIX *.test.mjs glob.
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(__dirname, name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
