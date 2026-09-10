// Local resource lifecycle faults only. All browser, Vite and filesystem IO is mocked.
import { beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const io = vi.hoisted(() => ({
  createServer: vi.fn(),
  launch: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));
vi.mock('vite', () => ({ createServer: io.createServer }));
vi.mock('@playwright/test', () => ({ chromium: { launch: io.launch } }));
vi.mock('node:fs/promises', () => ({ mkdtemp: io.mkdtemp, rm: io.rm }));
import { createDeploymentBrowserPool } from '../cloud/DeploymentBrowserPool';

function resources() {
  const page = {
    goto: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
  };
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => {}) };
  const server = {
    listen: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    httpServer: { address: () => ({ port: 12345 }) },
  };
  io.mkdtemp.mockResolvedValue(join(tmpdir(), 'dp06-probe-env-local-fixture'));
  io.rm.mockResolvedValue(undefined);
  io.createServer.mockResolvedValue(server);
  io.launch.mockResolvedValue(browser);
  return { page, context, browser, server };
}
beforeEach(() => vi.resetAllMocks());

it.each(['listen', 'launch'] as const)(
  'cleans resources and sanitizes a %s initialization failure',
  async (stage) => {
    const f = resources();
    if (stage === 'listen') f.server.listen.mockRejectedValueOnce(new Error('private arguments'));
    else io.launch.mockRejectedValueOnce(new Error('private arguments'));
    await expect(createDeploymentBrowserPool()).rejects.toThrow(
      'DP06_BROWSER_INITIALIZATION_FAILED',
    );
    expect(f.server.close).toHaveBeenCalledOnce();
    expect(io.rm).toHaveBeenCalledOnce();
  },
);

it('closes a partially initialized page and leaves the pool closable', async () => {
  const f = resources();
  f.page.waitForFunction.mockRejectedValueOnce(new Error('private arguments'));
  const pool = await createDeploymentBrowserPool();
  await expect(pool.create('player')).rejects.toThrow('DP06_BROWSER_INITIALIZATION_FAILED');
  expect(f.context.close).toHaveBeenCalledOnce();
  await pool.close();
  expect(f.browser.close).toHaveBeenCalledOnce();
  expect(f.server.close).toHaveBeenCalledOnce();
  expect(io.rm).toHaveBeenCalledOnce();
});

it('still closes Vite and removes the verified temporary directory after browser close fails', async () => {
  const f = resources();
  f.browser.close.mockRejectedValueOnce(new Error('private arguments'));
  const pool = await createDeploymentBrowserPool();
  const closing = pool.close();
  expect(pool.close()).toBe(closing);
  await expect(closing).rejects.toThrow('DP06_BROWSER_CLEANUP_FAILED');
  expect(f.server.close).toHaveBeenCalledOnce();
  expect(io.rm).toHaveBeenCalledOnce();
});

it('does not recursively delete a temporary path outside the required prefix', async () => {
  resources();
  io.mkdtemp.mockResolvedValue(join(tmpdir(), 'unrelated-directory'));
  const pool = await createDeploymentBrowserPool();
  await expect(pool.close()).rejects.toThrow('DP06_BROWSER_CLEANUP_FAILED');
  expect(io.rm).not.toHaveBeenCalled();
});
