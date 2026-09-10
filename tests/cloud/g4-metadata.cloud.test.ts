// F-13 / QA-08 Cloud half: the LiveKit room name, participant identities and metadata/attributes
// of the QA namespace carry no game coordinates, nicknames or exit information. Runs only through
// scripts/run-cloud-check.mjs with a preflight that allows QA-08; the E gateway is used with the
// real API budget so every call is accounted. No token or metadata values are written to evidence,
// only the offending field names and codes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { ApiBudget } from '../../server/src/operations/ApiBudget.ts';
import { LiveKitGateway } from '../../server/src/media/LiveKitGateway.ts';
import { caseTimeoutMs, requireCloudPreflight } from './CloudPreflight.ts';
import { evaluateMetadataObservation } from './MetadataObservation.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('QA-08', process.env, Date.now(), root);
const env = process.env;
for (const name of preflight.credentialEnvNames)
  if (!env[name]) throw new Error(`QA08_CREDENTIAL_${name}_MISSING`);
const evidenceDir = resolve(root, preflight.evidenceDir);

/** Field names that would mean a leak inside participant metadata/attributes. */
const FORBIDDEN_KEYS = /^(x|y|cell|dir|exit|exitId|approach|wall|nickname|seed|layout|role)$/i;
const findings: { room: string; identity: string; code: string; field: string }[] = [];
let observedRooms = 0;
let observedParticipants = 0;
let observationCompleted = false;

function inspect(room: string, identity: string, label: string, value: unknown) {
  if (!value) return;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return;
  for (const key of Object.keys(parsed as Record<string, unknown>))
    if (FORBIDDEN_KEYS.test(key))
      findings.push({ room, identity, code: 'METADATA_FIELD', field: `${label}.${key}` });
}

afterAll(() => {
  const observation = evaluateMetadataObservation(
    observedRooms,
    observedParticipants,
    observationCompleted,
  );
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    resolve(evidenceDir, 'g4-metadata.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        case: 'QA-08',
        namespace: preflight.namespace,
        status: observation.status === 'PASS' && findings.length === 0 ? 'PASS' : 'FAIL',
        observation,
        findings,
        note: 'Field names and codes only; no metadata values, tokens or identities beyond the namespace prefix check.',
      },
      null,
      2,
    ) + '\n',
  );
});

it(
  'QA-08: rooms of the namespace expose opaque identities and no game coordinates in metadata or attributes',
  async () => {
    const gateway = new LiveKitGateway(
      {
        httpUrl: env.LIVEKIT_HTTP_URL as string,
        apiKey: env.LIVEKIT_API_KEY as string,
        apiSecret: env.LIVEKIT_API_SECRET as string,
      },
      new ApiBudget({
        monotonicNow: () => performance.now(),
        maxNormalCallsPer60s: 60,
        maxTotalCallsPer60s: 120,
      }),
      { monotonicNow: () => performance.now() },
    );
    const rooms = (await gateway.listRooms()) as unknown as {
      name: string;
      metadata?: string;
    }[];
    const scoped = rooms.filter((r) => r.name.startsWith(`${preflight.namespace}--`));
    observedRooms = scoped.length;
    for (const room of scoped) {
      inspect(room.name, '-', 'room.metadata', room.metadata);
      const participants = (await gateway.listParticipants(room.name)) as unknown as {
        identity: string;
        name?: string;
        metadata?: string;
        attributes?: Record<string, string>;
      }[];
      observedParticipants += participants.length;
      for (const p of participants) {
        // Identities are opaque generation ids, never nicknames.
        if (!/^[A-Za-z0-9._:-]{8,}$/.test(p.identity) || /\s/.test(p.identity))
          findings.push({
            room: room.name,
            identity: '(redacted)',
            code: 'IDENTITY_NOT_OPAQUE',
            field: 'identity',
          });
        if (p.name && p.name !== p.identity)
          findings.push({
            room: room.name,
            identity: '(redacted)',
            code: 'DISPLAY_NAME_SET',
            field: 'name',
          });
        inspect(room.name, '(redacted)', 'participant.metadata', p.metadata);
        inspect(room.name, '(redacted)', 'participant.attributes', p.attributes);
      }
    }
    observationCompleted = true;
    const observation = evaluateMetadataObservation(observedRooms, observedParticipants, true);
    expect(observation.status, observation.code).toBe('PASS');
    expect(findings).toEqual([]);
  },
  caseTimeoutMs(preflight),
);
