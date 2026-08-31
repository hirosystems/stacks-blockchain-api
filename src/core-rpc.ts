import { createCoreRpcClient, CoreRpcClient } from '@stacks/rpc-client';
import { stopwatch, timeout } from '@stacks/api-toolkit';
import { ENV } from './env.js';

export function getCoreNodeEndpoint(opts?: { host?: string; port?: number | string }) {
  const host = opts?.host ?? ENV.STACKS_CORE_RPC_HOST;
  const port = opts?.port ?? ENV.STACKS_CORE_RPC_PORT;
  return `${host}:${port}`;
}

/** Creates a `@stacks/rpc-client` client pointed at the configured Stacks core node RPC endpoint.
 * @param opts - Optional host and port to use for the RPC client.
 * @returns A `@stacks/rpc-client` client.
 */
export function getCoreRpcClient(opts?: { host?: string; port?: number | string }): CoreRpcClient {
  return createCoreRpcClient({ baseUrl: `http://${getCoreNodeEndpoint(opts)}` });
}

/**
 * Try connecting to the node until successful or until the timeout is reached. Throws an error if a
 * connection cannot be established.
 * @param retryTimeout - milliseconds
 */
export async function waitForCoreRpcConnection(
  client: CoreRpcClient,
  retryTimeout = 60000
): Promise<void> {
  const retryInterval = 2500; // 2.5 seconds
  const timer = stopwatch();
  let lastError: Error;
  do {
    try {
      const info = await client.request('GET', '/v2/info');
      if (!info.stacks_tip_height || info.stacks_tip_height <= 0) {
        throw new Error(`stacks_tip_height not >= 1`);
      }
      return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      lastError = error;
      await timeout(retryInterval);
    }
  } while (timer.getElapsed() < retryTimeout);
  throw lastError;
}
