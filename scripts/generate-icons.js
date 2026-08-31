#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Creates valid PNG tray icons and a multi-resolution Windows installer ICO.
 * Run once during development setup:
 *   node scripts/generate-icons.js
 *
 * Colors:
 *   connected  — green  #22c55e
 *   uploading  — blue   #3b82f6
 *   offline    — amber  #f59e0b
 *   error      — red    #ef4444
 * (error.png is reused for "unpaired" state)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "..", "assets");
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Minimal valid 16×16 RGBA PNG builder (pure-node, no canvas required)
// Uses zlib to deflate raw pixel data.
const zlib = require("zlib");

function buildPng(width, height, fillRgba) {
  // RGBA raw pixels
  const scanlineSize = width * 4;
  const raw = Buffer.alloc(height * (1 + scanlineSize)); // 1 filter byte per row
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + scanlineSize);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const idx = rowStart + 1 + x * 4;
      raw[idx]     = fillRgba[0]; // R
      raw[idx + 1] = fillRgba[1]; // G
      raw[idx + 2] = fillRgba[2]; // B
      raw[idx + 3] = fillRgba[3]; // A
    }
  }

  const compressed = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBytes = Buffer.from(type, "ascii");
    const crc = crc32(Buffer.concat([typeBytes, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  // CRC-32 table
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c;
    }
    return t;
  })();

  function crc32(buf) {
    let crc = 0xffffffff;
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return crc ^ 0xffffffff;
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildIco(pngImages) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngImages.length, 4);

  const entries = [];
  let offset = 6 + pngImages.length * 16;
  for (const { size, png } of pngImages) {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngImages.map(({ png }) => png)]);
}

const icons = [
  { name: "icon-connected.png", rgba: [0x22, 0xc5, 0x5e, 0xff] }, // green
  { name: "icon-uploading.png", rgba: [0x3b, 0x82, 0xf6, 0xff] }, // blue
  { name: "icon-offline.png",   rgba: [0xf5, 0x9e, 0x0b, 0xff] }, // amber
  { name: "icon-error.png",     rgba: [0xef, 0x44, 0x44, 0xff] }, // red
  { name: "icon.png",           rgba: [0x1a, 0x56, 0xdb, 0xff] }, // brand blue (default)
];

for (const { name, rgba } of icons) {
  const png = buildPng(16, 16, rgba);
  const dest = path.join(ASSETS_DIR, name);
  fs.writeFileSync(dest, png);
  console.log("Created:", dest);
}

const installerColor = [0x1a, 0x56, 0xdb, 0xff];
const ico = buildIco(
  [16, 32, 48, 256].map((size) => ({
    size,
    png: buildPng(size, size, installerColor),
  }))
);
fs.writeFileSync(path.join(ASSETS_DIR, "icon.ico"), ico);
console.log("Created:", path.join(ASSETS_DIR, "icon.ico"));
