// make-icon.js — generates build/icon.ico for the packaged app.
// Draws the pet's purple cat face procedurally (no binary assets in the repo)
// and wraps the 256x256 PNG in a single-image ICO container, which Windows
// supports natively (PNG-in-ICO, Vista+) and electron-builder accepts.
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');

const SIZE = 256;

// Scene primitives, all in 256x256 space. Colors RGBA 0-255.
const BODY = [0x9b, 0x8f, 0xff, 255];
const BODY_DARK = [0x7a, 0x6d, 0xe8, 255]; // inner-ear / outline accents
const EYE_WHITE = [255, 255, 255, 255];
const PUPIL = [0x2a, 0x24, 0x4f, 255];
const BLUSH = [0xff, 0x9e, 0xc2, 140];

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// Returns the topmost color at a sample point, or null for transparent.
function colorAt(x, y) {
  // Pupils, then eye whites (left eye at 96,150 / right at 160,150).
  if (inCircle(x, y, 96, 154, 9) || inCircle(x, y, 160, 154, 9)) return PUPIL;
  if (inCircle(x, y, 96, 150, 18) || inCircle(x, y, 160, 150, 18)) return EYE_WHITE;
  // Blush dots.
  if (inCircle(x, y, 64, 182, 12) || inCircle(x, y, 192, 182, 12)) return BLUSH;
  // Smile: thin band of a circle arc, lower half only.
  const sd = Math.sqrt((x - 128) ** 2 + (y - 168) ** 2);
  if (y > 176 && sd >= 16 && sd <= 21 && Math.abs(x - 128) <= 18) return PUPIL;
  // Inner ears (darker triangles inside the outer ones).
  if (inTriangle(x, y, [62, 96], [84, 38], [104, 80]) ||
      inTriangle(x, y, [194, 96], [172, 38], [152, 80])) return BODY_DARK;
  // Outer ears.
  if (inTriangle(x, y, [50, 110], [80, 24], [116, 84]) ||
      inTriangle(x, y, [206, 110], [176, 24], [140, 84])) return BODY;
  // Head.
  if (inCircle(x, y, 128, 152, 96)) return BODY;
  return null;
}

// 3x3 supersampling for soft edges.
function render() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const c = colorAt(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
          if (c) {
            r += c[0] * c[3];
            g += c[1] * c[3];
            b += c[2] * c[3];
            a += c[3];
          }
        }
      }
      const i = (y * SIZE + x) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round(a / 9);
      }
    }
  }
  return rgba;
}

// ICO container: 6-byte header + one 16-byte directory entry + raw PNG bytes.
function wrapIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 encoded as 0
  entry[1] = 0; // height 256 encoded as 0
  entry[2] = 0; // no palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // data offset (6 + 16)

  return Buffer.concat([header, entry, png]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const png = encodePNG(render(), SIZE, SIZE);
fs.writeFileSync(path.join(outDir, 'icon.png'), png); // handy for Linux/docs
fs.writeFileSync(path.join(outDir, 'icon.ico'), wrapIco(png));
console.log('wrote build/icon.png and build/icon.ico');
