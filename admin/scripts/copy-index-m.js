const fs = require('node:fs');
const path = require('node:path');

const buildIndex = path.resolve(__dirname, '..', 'build', 'index_m.html');
const targetIndex = path.resolve(__dirname, '..', 'index_m.html');

if (!fs.existsSync(buildIndex)) {
  throw new Error(`Missing build output: ${buildIndex}`);
}

fs.copyFileSync(buildIndex, targetIndex);
console.log(`Copied ${buildIndex} -> ${targetIndex}`);
