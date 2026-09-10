// A local empty page only. Never call connect, publish, session or Cloud endpoints here.
import { expect, it } from 'vitest';
import { createDeploymentBrowserPool } from '../cloud/DeploymentBrowserPool';

it('loads the isolated browser probe and closes an empty page without Cloud IO', async () => {
  const pool = await createDeploymentBrowserPool();
  try {
    const probe = await pool.create('local-empty-probe');
    const empty = {
      connected: false,
      localTracks: [],
      allowedReceived: { video: 0, audio: 0 },
      forbiddenReceived: 0,
    };
    expect(await probe.snapshot()).toEqual(empty);
    await Promise.all([probe.close(), probe.close()]);
    expect(await probe.snapshot()).toEqual(empty);
    await Promise.all([pool.close(), pool.close()]);
    await expect(pool.create('after-close')).rejects.toThrow('DP06_BROWSER_POOL_CLOSED');
  } finally {
    await pool.close();
  }
}, 30000);
