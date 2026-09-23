import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function encodeRgbaPng({ width, height, pixel }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('PNG_DIMENSIONS_INVALID');
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha = 255] = pixel(x, y, width, height);
      const offset = row + 1 + x * 4;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PALETTES = {
  runner: [
    [224, 217, 198, 255],
    [176, 165, 145, 255],
    [62, 57, 50, 255],
    [116, 104, 88, 255],
  ],
  tagger: [
    [43, 38, 35, 255],
    [111, 101, 91, 255],
    [22, 18, 17, 255],
    [201, 190, 160, 255],
  ],
};

export function avatarAtlas(role, size, kind = 'color') {
  const palette = PALETTES[role];
  if (!palette) throw new Error('AVATAR_ROLE_INVALID');
  return encodeRgbaPng({
    width: size,
    height: size,
    pixel(x, y) {
      const column = Math.min(3, Math.floor((x / size) * 4));
      if (kind === 'roughness') {
        const roughness = [236, 215, 247, 188][column];
        return [roughness, roughness, roughness, 255];
      }
      const base = palette[column];
      const weave = (x * 13 + y * 7) % 29 < 3 ? -7 : 0;
      const stain = y > size * 0.72 && (x * 5 + y * 3) % 41 < 5 ? -12 : 0;
      return [
        Math.max(0, base[0] + weave + stain),
        Math.max(0, base[1] + weave + stain),
        Math.max(0, base[2] + weave + stain),
        base[3],
      ];
    },
  });
}
