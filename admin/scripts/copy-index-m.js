const fs = require('node:fs');
const path = require('node:path');

const adminDir = path.resolve(__dirname, '..');

const indexCandidates = [
  path.join(adminDir, 'build', 'index_m.html'),
  path.join(adminDir, 'build', 'src', 'index_m.html'),
];

const assetsCandidates = [
  path.join(adminDir, 'build', 'assets'),
  path.join(adminDir, 'build', 'src', 'assets'),
];

const buildIndex = indexCandidates.find(p => fs.existsSync(p));
const buildAssets = assetsCandidates.find(p => fs.existsSync(p));

const targetIndex = path.join(adminDir, 'index_m.html');
const targetAssets = path.join(adminDir, 'assets');

if (!buildIndex) {
  throw new Error(`Missing build output. Tried:\n- ${indexCandidates.join('\n- ')}`);
}
fs.copyFileSync(buildIndex, targetIndex);
console.log(`Copied ${buildIndex} -> ${targetIndex}`);

if (!buildAssets) {
  throw new Error(`Missing build assets. Tried:\n- ${assetsCandidates.join('\n- ')}`);
}

// ab hier läuft dein bestehender Code weiter:
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
