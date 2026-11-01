/**
 * Validates image content using magic bytes.
 * Supports JPEG, PNG, and WebP (RIFF....WEBP).
 *
 * @param {Buffer} buffer - First >= 12 bytes of file
 * @returns {string|null} - 'image/jpeg', 'image/png', 'image/webp' or null
 */
function detectImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // 2. PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // 3. WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

/**
 * Strips EXIF metadata chunk (APP1: FF E1) from JPEG buffer if present.
 *
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function stripJpegExif(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    return buffer;
  }

  let offset = 2;
  const chunks = [buffer.subarray(0, 2)]; // SOI

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xFF) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const marker = buffer[offset + 1];
    // SOS (Start of Scan) or EOI (End of Image) -> rest is image data
    if (marker === 0xDA || marker === 0xD9) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    // Read marker segment length
    if (offset + 3 >= buffer.length) break;
    const length = (buffer[offset + 2] << 8) | buffer[offset + 3];

    // Marker 0xE1 is APP1 (EXIF metadata). Skip it!
    if (marker === 0xE1) {
      offset += 2 + length;
    } else {
      chunks.push(buffer.subarray(offset, offset + 2 + length));
      offset += 2 + length;
    }
  }

  return Buffer.concat(chunks);
}

module.exports = {
  detectImageMime,
  stripJpegExif
};

