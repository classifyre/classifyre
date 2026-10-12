import { deflateSync } from 'node:zlib';
import type { EmbeddingMediaItem, MediaModality } from './embedding-modality';

/**
 * Small made-up media for the "test connection" button.
 *
 * A provider that says it takes pictures is only proven to by sending it one.
 * These are generated rather than shipped as files: a 64-pixel gradient and a
 * second of a 440 Hz tone are enough for an encoder to accept, and cost a few
 * hundred tokens at most.
 */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A 64 x 64 colour gradient as a PNG. */
export function probeImage(): EmbeddingMediaItem {
  const size = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // truecolour
  const rows = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    // rows[row] stays 0: no filter.
    for (let x = 0; x < size; x++) {
      const pixel = row + 1 + x * 3;
      rows[pixel] = x * 4;
      rows[pixel + 1] = y * 4;
      rows[pixel + 2] = 128;
    }
  }
  return {
    modality: 'image',
    mimeType: 'image/png',
    data: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(rows)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  };
}

/** One second of a 440 Hz tone: mono, 16 kHz, 16-bit WAV. */
export function probeAudio(): EmbeddingMediaItem {
  const rate = 16_000;
  const samples = rate;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples * 2, 40);
  const body = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    body.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * index) / rate) * 12_000),
      index * 2,
    );
  }
  return {
    modality: 'audio',
    mimeType: 'audio/wav',
    data: Buffer.concat([header, body]),
  };
}

export function probeMedia(modality: MediaModality): EmbeddingMediaItem {
  return modality === 'audio' ? probeAudio() : probeImage();
}
