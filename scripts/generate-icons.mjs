#!/usr/bin/env node
/**
 * generate-icons.mjs
 * Converts build/icon.svg → PNG at multiple sizes → Windows .ico
 * Requires: sharp, png-to-ico
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const buildDir = join(projectRoot, 'build');
const webPublicDir = join(projectRoot, 'web', 'public');

// Ensure output directories exist
if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });
if (!existsSync(webPublicDir)) mkdirSync(webPublicDir, { recursive: true });

const require = createRequire(import.meta.url);
const sharp = (await import('sharp')).default;
const pngToIco = (await import('png-to-ico')).default;

const svgPath = join(buildDir, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

const SIZES = [16, 32, 48, 64, 128, 256];

console.log('Stellar Memory — Icon Generator');
console.log('================================');
console.log(`Source: ${svgPath}`);
console.log(`Output: ${buildDir}`);
console.log('');

// ─── Step 1: Generate PNGs at all sizes ───────────────────────────────────────
const pngPaths = [];

for (const size of SIZES) {
  const outPath = join(buildDir, `icon-${size}.png`);

  await sharp(svgBuffer, { density: Math.ceil((size / 256) * 300) })
    .resize(size, size, {
      kernel: sharp.kernel.lanczos3,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile(outPath);

  pngPaths.push(outPath);
  console.log(`  Generated ${size}x${size} → icon-${size}.png`);
}

// ─── Step 2: Save the 256x256 as the canonical icon.png ──────────────────────
const png256Path = join(buildDir, 'icon-256.png');
const iconPngPath = join(buildDir, 'icon.png');

import { copyFileSync } from 'fs';
copyFileSync(png256Path, iconPngPath);
console.log(`\n  Saved canonical 256x256 → icon.png`);

// ─── Step 3: Build .ico from all PNGs ────────────────────────────────────────
console.log('\n  Building icon.ico from all sizes...');

const icoBuffer = await pngToIco(pngPaths);

const icoPath = join(buildDir, 'icon.ico');
writeFileSync(icoPath, icoBuffer);
console.log(`  Saved → icon.ico (${(icoBuffer.length / 1024).toFixed(1)} KB)`);

// ─── Step 4: Copy to web/public/favicon.ico ──────────────────────────────────
const faviconPath = join(webPublicDir, 'favicon.ico');
writeFileSync(faviconPath, icoBuffer);
console.log(`  Copied → web/public/favicon.ico`);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n================================');
console.log('Done. Files generated:');
console.log(`  build/icon.svg          (source)`);
console.log(`  build/icon.png          (256x256 PNG)`);
for (const size of SIZES) {
  console.log(`  build/icon-${size}.png${size < 100 ? ' ' : ''}       (${size}x${size})`);
}
console.log(`  build/icon.ico          (multi-size Windows ICO)`);
console.log(`  web/public/favicon.ico  (favicon)`);
