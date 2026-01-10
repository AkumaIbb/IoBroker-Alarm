const fs = require('node:fs');
const path = require('node:path');

const buildDir = path.resolve(__dirname, '..', 'build');
const buildIndex = path.join(buildDir, 'index_m.html');
const buildAssets = path.join(buildDir, 'assets');
const targetIndex = path.resolve(__dirname, '..', 'index_m.html');
const targetAssets = path.resolve(__dirname, '..', 'assets');

if (!fs.existsSync(buildIndex)) {
  throw new Error(`Missing build output: ${buildIndex}`);
}

fs.copyFileSync(buildIndex, targetIndex);
console.log(`Copied ${buildIndex} -> ${targetIndex}`);

if (!fs.existsSync(buildAssets)) {
  throw new Error(`Missing build assets: ${buildAssets}`);
}

fs.rmSync(targetAssets, { recursive: true, force: true });
fs.mkdirSync(targetAssets, { recursive: true });

const copyDir = (srcDir, destDir) => {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

copyDir(buildAssets, targetAssets);
console.log(`Copied ${buildAssets} -> ${targetAssets}`);
