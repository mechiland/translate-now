// Regenerate public/icon/*.png from assets/icon.svg (requires rsvg-convert).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  execFileSync('rsvg-convert', [
    '-w',
    String(size),
    '-h',
    String(size),
    'assets/icon.svg',
    '-o',
    `public/icon/${size}.png`,
  ]);
}
console.log('icons generated');
