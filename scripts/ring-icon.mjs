import { deflateSync } from "node:zlib";
// Code-native ring asset, using the same forest/ochre tokens as the companion.
export function ringPng(size = 256, backdrop = false) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let alpha = 0,
        ochre = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const dx = (x + (sx + 0.5) / 4 - size / 2) / size,
            dy = (y + (sy + 0.5) / 4 - size / 2) / size;
          const radius = Math.hypot(dx, dy),
            angle = Math.atan2(dy, dx);
          if (
            radius > 0.31 &&
            radius < 0.39 &&
            !(angle > -0.5 * Math.PI - 0.35 && angle < -0.5 * Math.PI + 0.35)
          ) {
            alpha++;
            if (dx < 0 && dy > 0) ochre++;
          }
        }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const background =
        backdrop &&
        Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) < size * 0.46;
      if (!alpha && !background) continue;
      const color = ochre > alpha / 2 ? [164, 108, 8] : [23, 78, 61];
      for (let c = 0; c < 3; c++)
        pixels[i + c] = background
          ? Math.round(
              (color[c] * alpha) / 16 + [250, 247, 241][c] * (1 - alpha / 16),
            )
          : color[c];
      pixels[i + 3] = background ? 255 : Math.round((alpha / 16) * 255);
    }
  const crc = (buffer) => {
    let n = 0xffffffff;
    for (const b of buffer) {
      n ^= b;
      for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const data = Buffer.concat([Buffer.from(type), body]),
      header = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    tail.writeUInt32BE(crc(data));
    return Buffer.concat([header, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
