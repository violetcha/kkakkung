// F-02 / QA-01 evidence format: the common header is mandatory, secrets and raw media are refused
// by key and by value shape, too few samples cannot become a result, and clock offsets are
// estimated from round trips rather than subtracted raw. Writes go to a temp directory only.
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EvidenceRejected,
  effectiveLatencyMs,
  estimateClockOffset,
  validateEvidence,
  writeEvidence,
  type EvidenceDocument,
} from '../../tests/cloud/EvidenceWriter.ts';
import {
  decodeFace,
  decodeTone,
  faceHueFor,
  toneFrequencyFor,
} from '../../tests/cloud/SyntheticMedia.ts';

const dir = mkdtempSync(join(tmpdir(), 'qa01-evidence-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const doc = (over: Partial<EvidenceDocument> = {}): EvidenceDocument => ({
  sourceCommit: 'a'.repeat(40),
  lockfileHash: 'b'.repeat(64),
  protocolVersion: '0.2.0',
  tuningVersion: 'mvp-v1',
  sdkVersion: 'livekit-client 2.22.2 / server-sdk 2.18.0',
  browserVersion: 'Chrome 152.0.7977',
  accountAlias: 'kkakkung-qa',
  environment: 'cloud-poc',
  recordedAt: '2026-09-10T05:00:00.000Z',
  stage: 'QA-03 v10-delay',
  result: 'PASS',
  cleanupState: 'confirmed',
  samples: [{ requestId: 'req-1', effectLatencyMs: 320, confirmed: true }],
  ...over,
});

describe('evidence header and secret refusal', () => {
  it('a complete document validates and is frozen; a missing header field is rejected by name', () => {
    const valid = validateEvidence(doc());
    expect(Object.isFrozen(valid)).toBe(true);
    expect(() => validateEvidence(doc({ tuningVersion: '' }))).toThrow(
      'HEADER_MISSING:tuningVersion',
    );
    expect(() => validateEvidence(doc({ sourceCommit: 'abc' }))).toThrow(
      'HEADER_MISSING:sourceCommit',
    );
    expect(validateEvidence(doc({ browserVersion: null })).browserVersion).toBeNull();
  });

  it('a token or rawSdp key anywhere is refused by path, and the value never appears in the error', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig';
    const nested = doc({ samples: [{ requestId: 'r', grant: { token: jwt } }] });
    let error: unknown;
    try {
      validateEvidence(nested);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EvidenceRejected);
    expect((error as EvidenceRejected).path).toBe('$.samples[0].grant.token');
    expect(String(error)).not.toContain('eyJ');
    expect(() => validateEvidence(doc({ samples: [{ rawSdp: 'v=0\r\no=-' }] }))).toThrow(
      'FORBIDDEN_KEY:$.samples[0].rawSdp',
    );
    // Value shapes are caught even under an innocent key.
    expect(() => validateEvidence(doc({ samples: [{ note: jwt }] }))).toThrow(
      'FORBIDDEN_VALUE:$.samples[0].note',
    );
    expect(() =>
      validateEvidence(doc({ samples: [{ blob: 'v=0\r\no=- 1 2 IN IP4 0.0.0.0' }] })),
    ).toThrow('FORBIDDEN_VALUE');
    expect(() =>
      validateEvidence(doc({ samples: [{ face: 'data:image/png;base64,AAAA' }] })),
    ).toThrow('FORBIDDEN_VALUE');
    expect(() =>
      validateEvidence(doc({ samples: [{ pcm: new Uint8Array(4) as unknown as number }] })),
    ).toThrow('FORBIDDEN_VALUE');
  });

  it('too few samples cannot be a PASS/FAIL result, but BLOCKED and NOT_RUN may be recorded without samples', () => {
    expect(() => validateEvidence(doc({ samples: [] }))).toThrow('TOO_FEW_SAMPLES');
    expect(() => validateEvidence(doc({ samples: [{ a: 1 }] }), 3)).toThrow(
      'TOO_FEW_SAMPLES:samples(1<3)',
    );
    expect(validateEvidence(doc({ result: 'BLOCKED', samples: [] })).result).toBe('BLOCKED');
    expect(validateEvidence(doc({ result: 'NOT_RUN', samples: [] })).result).toBe('NOT_RUN');
  });

  it('writeEvidence stores only validated documents and refuses to write a rejected one', () => {
    const file = writeEvidence(dir, 'ok', doc());
    expect(JSON.parse(readFileSync(file, 'utf8')).stage).toBe('QA-03 v10-delay');
    expect(() => writeEvidence(dir, 'bad', doc({ samples: [{ apiSecret: 'x' }] }))).toThrow(
      'FORBIDDEN_KEY',
    );
    expect(existsSync(join(dir, 'bad.json'))).toBe(false);
  });
});

describe('clocks and markers', () => {
  it('estimates the remote offset from the tightest round trip and refuses to judge inside the uncertainty', () => {
    const offset = estimateClockOffset([
      { sentAtMs: 1000, remoteAtMs: 1520, receivedAtMs: 1080 }, // rtt 80 → offset 480 ± 40
      { sentAtMs: 2000, remoteAtMs: 2510, receivedAtMs: 2020 }, // rtt 20 → offset 500 ± 10 (tightest)
    ]);
    expect(offset).toEqual({ offsetMs: 500, uncertaintyMs: 10, samples: 2 });
    // policyAt (server) 10_000, effectAt (browser) 10_800 → 800 - 500 = 300 ms, clearly under 500.
    expect(effectiveLatencyMs(10_000, 10_800, offset!, 500)).toEqual({
      latencyMs: 300,
      confirmed: true,
    });
    // 495 ms with ±10 ms uncertainty straddles the 500 ms threshold: unconfirmed, not PASS.
    expect(effectiveLatencyMs(10_000, 10_995, offset!, 500)).toEqual({
      latencyMs: 495,
      confirmed: false,
    });
    expect(estimateClockOffset([])).toBeNull();
  });

  it('face and tone markers round-trip through their pure encoders', () => {
    expect(decodeFace(faceHueFor(123), 123)).toEqual({ frameSerial: 123, hue: faceHueFor(123) });
    expect(decodeFace(faceHueFor(123) + 40, 123)).toBeNull();
    expect(decodeTone(toneFrequencyFor(13), 1)).toBe(13);
    expect(decodeTone(1000, 0)).toBeNull();
  });
});
