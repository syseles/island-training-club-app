import { assert, assertEquals, assertRejects } from '@std/assert';
import { Image } from 'imagescript';
import { readBodyLimited, sanitizeAvatar } from './avatar-image.ts';
import { MAX_UPLOAD_BYTES } from './avatar-policy.ts';

const JPEG_2X1 = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDVooor4Q/io//Z',
  ),
  (character) => character.charCodeAt(0),
);
const PNG_2X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGOUOJHAwMAAAAYGAUL2fM46AAAAAElFTkSuQmCC',
  ),
  (character) => character.charCodeAt(0),
);
const textEncoder = new TextEncoder();

Deno.test('JPEG input is decoded and sanitized to a 512 square JPEG', async () => {
  const output = await sanitizeAvatar(JPEG_2X1);
  assertEquals([...output.slice(0, 3)], [0xff, 0xd8, 0xff]);
  const decoded = await Image.decode(output);
  assertEquals(decoded.width, 512);
  assertEquals(decoded.height, 512);
});

Deno.test('PNG input is decoded and sanitized to a 512 square JPEG', async () => {
  const output = await sanitizeAvatar(PNG_2X1);
  assertEquals([...output.slice(0, 3)], [0xff, 0xd8, 0xff]);
  const decoded = await Image.decode(output);
  assertEquals(decoded.width, 512);
  assertEquals(decoded.height, 512);
});

Deno.test('SVG and GIF payloads are rejected before decode', async () => {
  await assertRejects(
    () => sanitizeAvatar(textEncoder.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    Error,
    'Only JPEG or PNG images are accepted',
  );
  await assertRejects(
    () => sanitizeAvatar(textEncoder.encode('GIF89a')),
    Error,
    'Only JPEG or PNG images are accepted',
  );
});

Deno.test('malformed JPEG is rejected', async () => {
  await assertRejects(
    () => sanitizeAvatar(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    Error,
    'Image could not be decoded',
  );
});

Deno.test('payload over 2 MB is rejected before decode', async () => {
  const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  await assertRejects(() => sanitizeAvatar(oversized), Error, 'Image exceeds 2 MB');
});

Deno.test('declared dimensions over 4096 pixels are rejected before decode', async () => {
  const oversizedHeader = new Uint8Array(24);
  oversizedHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  oversizedHeader.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(oversizedHeader.buffer).setUint32(16, 4097);
  new DataView(oversizedHeader.buffer).setUint32(20, 1);
  await assertRejects(
    () => sanitizeAvatar(oversizedHeader),
    Error,
    'Image dimensions exceed 4096 pixels',
  );
});

Deno.test('fresh JPEG output contains none of the source metadata marker text', async () => {
  const marker = textEncoder.encode('Exif\0\0GPSLatitude=22.3193;GPSLongitude=114.1694');
  const source = new Uint8Array(JPEG_2X1.length + marker.length);
  source.set(JPEG_2X1);
  source.set(marker, JPEG_2X1.length);
  const output = await sanitizeAvatar(source);
  const outputText = new TextDecoder('latin1').decode(output);
  assert(!outputText.includes('Exif'));
  assert(!outputText.includes('GPSLatitude'));
  assert(!outputText.includes('22.3193'));
});

Deno.test('bounded response reader rejects declared and streamed oversize bodies', async () => {
  await assertRejects(
    () =>
      readBodyLimited(
        new Response('small', { headers: { 'content-length': String(MAX_UPLOAD_BYTES + 1) } }),
        MAX_UPLOAD_BYTES,
      ),
    Error,
    'Image exceeds 2 MB',
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
  await assertRejects(
    () => readBodyLimited(new Response(stream), 7),
    Error,
    'Image exceeds 2 MB',
  );
});
