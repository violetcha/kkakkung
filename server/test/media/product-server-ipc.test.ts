import { describe, expect, it } from 'vitest';
import {
  PRODUCT_SERVER_IPC,
  isProductServerMessage,
  productServerReplySchema,
  productServerRequestSchema,
} from './product-server-ipc.js';

describe('isolated product server IPC boundary', () => {
  it('separates unrelated loader/runtime messages from application replies', () => {
    for (const message of [null, 'ready', { type: 'runtime-notification' }, { namespace: 'other' }])
      expect(isProductServerMessage(message)).toBe(false);
    expect(isProductServerMessage({ namespace: PRODUCT_SERVER_IPC })).toBe(true);
  });

  it('strictly rejects malformed messages in the application namespace', () => {
    const malformed = { namespace: PRODUCT_SERVER_IPC, type: 'runtime-notification' };
    expect(isProductServerMessage(malformed)).toBe(true);
    expect(productServerReplySchema.safeParse(malformed).success).toBe(false);
    expect(productServerRequestSchema.safeParse(malformed).success).toBe(false);
    expect(
      productServerReplySchema.safeParse({
        namespace: PRODUCT_SERVER_IPC,
        id: 1,
        ok: true,
        result: { port: 2567, pid: 1, strictProduct: true, mapTemplate: 'master-v1' },
      }).success,
    ).toBe(true);
  });

  it('allows publication metadata but refuses credentials or grant JWT in IPC', () => {
    const request = {
      namespace: PRODUCT_SERVER_IPC,
      id: 1,
      action: 'publish',
      publication: { roomName: 'local-fixture', mediaIdentity: 'local-identity' },
    };
    expect(productServerRequestSchema.safeParse(request).success).toBe(true);
    expect(
      productServerRequestSchema.safeParse({
        ...request,
        publication: { ...request.publication, token: 'synthetic-rejected-token' },
      }).success,
    ).toBe(false);
    expect(
      productServerRequestSchema.safeParse({ ...request, apiSecret: 'synthetic-rejected-secret' })
        .success,
    ).toBe(false);
  });
});
