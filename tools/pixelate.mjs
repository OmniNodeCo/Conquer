// Downscale artwork to true pixel resolution, then upscale it nearest-neighbour
// so every visible block is exactly BLOCK device pixels. Keeps the title screen
// in the same visual language as the map.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, readFileSync } from 'node:fs';

const [src = 'assets/title-art-pixel.png', out = 'assets/title-art.jpg', blockArg = '4'] = process.argv.slice(2);
const BLOCK = Math.max(2, Number(blockArg) || 4);

const img = await loadImage(readFileSync(src));
const lowW = Math.round(img.width / BLOCK);
const lowH = Math.round(img.height / BLOCK);

const low = createCanvas(lowW, lowH);
const lctx = low.getContext('2d');
lctx.imageSmoothingEnabled = true;
lctx.imageSmoothingQuality = 'high';
lctx.drawImage(img, 0, 0, lowW, lowH);

const outW = lowW * BLOCK;
const outH = lowH * BLOCK;
const big = createCanvas(outW, outH);
const bctx = big.getContext('2d');
bctx.imageSmoothingEnabled = false;
bctx.drawImage(low, 0, 0, outW, outH);

writeFileSync(out, big.toBuffer('image/jpeg', 92));
console.log(`pixelated ${src} -> ${out} (${lowW}x${lowH} blocks, ${BLOCK}px each, ${outW}x${outH})`);
