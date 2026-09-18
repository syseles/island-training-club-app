import { Image } from 'imagescript';
import { MAX_DECODED_EDGE, MAX_UPLOAD_BYTES, OUTPUT_EDGE } from './avatar-policy.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_START_OF_FRAME = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function exceedsLimitError(): Error {
  return new Error('Image exceeds 2 MB');
}

export async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Invalid response size limit');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw exceedsLimitError();
  }
  if (!response.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw exceedsLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 >= bytes.length) break;

    const segmentLength = (bytes[offset + 1] << 8) | bytes[offset + 2];
    if (segmentLength < 2 || offset + segmentLength >= bytes.length) break;
    if (JPEG_START_OF_FRAME.has(marker) && segmentLength >= 7) {
      return {
        height: (bytes[offset + 4] << 8) | bytes[offset + 5],
        width: (bytes[offset + 6] << 8) | bytes[offset + 7],
      };
    }
    offset += segmentLength + 1;
  }
  return null;
}

function assertDimensionsWithinLimit(dimensions: { width: number; height: number } | null): void {
  if (!dimensions) return;
  if (
    dimensions.width < 1 || dimensions.height < 1 ||
    dimensions.width > MAX_DECODED_EDGE || dimensions.height > MAX_DECODED_EDGE
  ) {
    throw new Error(`Image dimensions exceed ${MAX_DECODED_EDGE} pixels`);
  }
}

export async function sanitizeAvatar(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw exceedsLimitError();

  const png = isPng(bytes);
  const jpeg = isJpeg(bytes);
  if (!png && !jpeg) {
    throw new Error('Only JPEG or PNG images are accepted');
  }
  assertDimensionsWithinLimit(png ? pngDimensions(bytes) : jpegDimensions(bytes));

  let image: Image;
  try {
    image = await Image.decode(bytes);
  } catch {
    throw new Error('Image could not be decoded');
  }
  assertDimensionsWithinLimit({ width: image.width, height: image.height });

  const cropEdge = Math.min(image.width, image.height);
  image.crop(
    Math.floor((image.width - cropEdge) / 2),
    Math.floor((image.height - cropEdge) / 2),
    cropEdge,
    cropEdge,
  );
  image.resize(OUTPUT_EDGE, OUTPUT_EDGE);
  return await image.encodeJPEG(85);
}
