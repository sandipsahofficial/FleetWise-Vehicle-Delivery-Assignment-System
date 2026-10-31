#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const directories = ['src', 'tests', 'scripts'];
const rootDir = path.resolve(__dirname, '..');

let totalChecked = 0;
let errors = 0;

function checkFile(filePath) {
  try {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    totalChecked++;
  } catch (err) {
    console.error(`Syntax error in ${path.relative(rootDir, filePath)}:`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    errors++;
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      checkFile(fullPath);
    }
  }
}

for (const dir of directories) {
  walkDir(path.join(rootDir, dir));
}

if (errors > 0) {
  console.error(`\nLint failed: ${errors} file(s) with syntax errors.`);
  process.exit(1);
} else {
  console.log(`Lint passed: ${totalChecked} file(s) checked with node --check.`);
}
