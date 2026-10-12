import {
  decodeWavMono16k,
  truncateVectors,
  upsampleTo48k,
} from './transformers-embedding.worker';

function wav(options: {
  rate?: number;
  channels?: number;
  bits?: number;
  samples: number[];
  extraChunk?: boolean;
}): Buffer {
  const { rate = 16_000, channels = 1, bits = 16, samples } = options;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(value, index * 2));
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE((rate * channels * bits) / 8, 16);
  fmt.writeUInt16LE((channels * bits) / 8, 20);
  fmt.writeUInt16LE(bits, 22);
  // A LIST chunk of odd length, as real encoders write: 3 bytes and a pad.
  const list = options.extraChunk
    ? Buffer.concat([
        Buffer.from('LIST', 'ascii'),
        Buffer.from([3, 0, 0, 0]),
        Buffer.from([1, 2, 3, 0]),
      ])
    : Buffer.alloc(0);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([
    Buffer.from('WAVE', 'ascii'),
    fmt,
    list,
    dataHeader,
    data,
  ]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/**
 * The scan prepares sound as 16-bit mono WAV at 16 kHz, which is what the
 * audio encoder is trained on. The worker reads that one format. Anything
 * else has to be refused by name: samples at the wrong rate embed without
 * complaint, as a sound an octave away from the one recorded.
 */
describe('local media decoding', () => {
  it('reads 16-bit samples as fractions of full scale', () => {
    const samples = decodeWavMono16k(wav({ samples: [0, 16384, -32768] }));

    expect([...samples]).toEqual([0, 0.5, -1]);
  });

  it('mixes two channels down to one', () => {
    const samples = decodeWavMono16k(
      wav({ channels: 2, samples: [16384, 0, -16384, -16384] }),
    );

    expect([...samples]).toEqual([0.25, -0.5]);
  });

  it('steps over chunks it does not need, pad byte included', () => {
    const samples = decodeWavMono16k(
      wav({ samples: [16384], extraChunk: true }),
    );

    expect([...samples]).toEqual([0.5]);
  });

  it('refuses audio at another sample rate', () => {
    expect(() => decodeWavMono16k(wav({ rate: 44_100, samples: [0] }))).toThrow(
      /44100 Hz.*expected 16000 Hz/,
    );
  });

  it('refuses what is not a WAV file', () => {
    expect(() => decodeWavMono16k(Buffer.from('ID3 not a wav file'))).toThrow(
      /not a WAV file/,
    );
  });

  // A model trained so that the start of its vector is itself a vector can be
  // stored shorter. Cutting alone leaves a vector that is no longer unit
  // length, and a dot product that is no longer a cosine.
  it('cuts a vector shorter and restores its unit length', () => {
    const [cut] = truncateVectors([[0.6, 0.8, 0.5, 0.5]], 2);

    expect(cut).toHaveLength(2);
    expect(Math.hypot(...cut)).toBeCloseTo(1, 10);
    expect(cut[0] / cut[1]).toBeCloseTo(0.75, 10);
  });

  // CLAP listens at 48 kHz and scans store 16: three samples for each one,
  // on a straight line to the next, so pitch and length stay what they were.
  it('triples a clip for a model that listens at 48 kHz', () => {
    const out = upsampleTo48k(Float32Array.from([0, 0.3, -0.3]));

    expect(out).toHaveLength(9);
    expect(Array.from(out.slice(0, 4))).toEqual(
      [0, 0.1, 0.2, 0.3].map((value) => Math.fround(value)),
    );
    // The last sample has no neighbour to lean towards.
    expect(Array.from(out.slice(6))).toEqual(
      [-0.3, -0.3, -0.3].map((value) => Math.fround(value)),
    );
  });

  it('leaves a vector alone at its own width or with none asked', () => {
    const vectors = [[0.6, 0.8]];

    expect(truncateVectors(vectors, 2)[0]).toBe(vectors[0]);
    expect(truncateVectors(vectors, 768)[0]).toBe(vectors[0]);
    expect(truncateVectors(vectors)[0]).toBe(vectors[0]);
  });
});
