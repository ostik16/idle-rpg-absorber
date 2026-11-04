/** CRC-32 (IEEE 802.3, the zip and PNG one) of a string's UTF-8 bytes, for the save envelope (ADR 0003). */

const TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});

/** The checksum as 8 lowercase hex digits. */
export function crc32(text: string): string {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc = (TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
