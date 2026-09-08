/**
 * Rasterises the PalaGo brand vector into the PNGs Expo needs.
 *
 *   node scripts/generate-icons.mjs
 *
 * Source of truth is assets/brand/palago-icon.svg — edit that, re-run this, and
 * never hand-edit the generated PNGs.
 *
 * If you have the original brand raster art, drop it in as
 * assets/brand/palago-icon-source.png and this script will use it instead of
 * the vector.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const brand = path.join(root, 'assets', 'brand');
const images = path.join(root, 'assets', 'images');

const override = path.join(brand, 'palago-icon-source.png');
const useOverride = fs.existsSync(override);
const source = useOverride ? override : path.join(brand, 'palago-icon.svg');

console.log(`source: ${path.relative(root, source)}${useOverride ? ' (original art)' : ' (vector)'}`);

/** Square PNG on a transparent ground. */
async function square(size, out) {
  await sharp(source, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(images, out));
  console.log(`  ${out} ${size}x${size}`);
}

/**
 * Android adaptive icons are cropped to a circle/squircle by the launcher, so
 * the artwork has to sit inside the safe zone — roughly the middle 66% — or the
 * launcher clips the palm and the bus.
 */
async function adaptiveForeground(size, out) {
  const inner = Math.round(size * 0.62);
  const pad = Math.round((size - inner) / 2);

  const art = await sharp(source, { density: 512 }).resize(inner, inner).png().toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .png()
    .toFile(path.join(images, out));
  console.log(`  ${out} ${size}x${size} (art inset to the adaptive safe zone)`);
}

/** Flat one-colour silhouette for Android themed icons. */
async function monochrome(size, out) {
  const inner = Math.round(size * 0.62);
  const pad = Math.round((size - inner) / 2);

  const art = await sharp(source, { density: 512 })
    .resize(inner, inner)
    .greyscale()
    .normalise()
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .png()
    .toFile(path.join(images, out));
  console.log(`  ${out} ${size}x${size} (monochrome)`);
}

async function solid(size, hex, out) {
  const { r, g, b } = {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
  await sharp({ create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toFile(path.join(images, out));
  console.log(`  ${out} ${size}x${size} (solid ${hex})`);
}

await square(1024, 'icon.png');
await square(512, 'splash-icon.png');
await square(196, 'favicon.png');
await adaptiveForeground(1024, 'android-icon-foreground.png');
await monochrome(1024, 'android-icon-monochrome.png');
await solid(1024, '#E6F2EC', 'android-icon-background.png');

console.log('done');
