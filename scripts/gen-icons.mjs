// Regenerate public/icon/*.png from src/assets/icon.svg (requires rsvg-convert).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  execFileSync('rsvg-convert', [
    '-w',
    String(size),
    '-h',
    String(size),
    'src/assets/icon.svg',
    '-o',
    `public/icon/${size}.png`,
  ]);
}
console.log('icons generated');
