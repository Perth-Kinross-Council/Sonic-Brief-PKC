#!/usr/bin/env node
/**
 * Fails if any source file contains lines starting with // console.
 * Helps prevent reintroduction of commented-out console noise.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = new URL('../src', import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return [p];
  });
}

const files = walk(SRC_DIR).filter(f => /\.(tsx?|jsx?)$/.test(f));
const bad = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*\/\/\s*console\./.test(line)) {
      bad.push(`${f}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (bad.length) {
  console.error(`Found ${bad.length} commented console lines:`);
  bad.slice(0, 50).forEach(l => console.error(l));
  if (bad.length > 50) console.error('...');
  process.exit(1);
}

console.log('No commented-out console.* lines found.');
