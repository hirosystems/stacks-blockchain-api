/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fetch, { RequestInit } from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs';
import { parsePort, stopwatch, logError, timeout, REPO_DIR } from '../helpers';
import { CoreNodeFeeResponse } from '@stacks/stacks-blockchain-api-types';

interface CoreRpcAccountInfo {
  /** Hex-prefixed uint128. */
  balance: string;
  /** Hex-prefixed binary blob. */
  balance_proof: string;
  locked: string;
  nonce: number;
  /** Hex-prefixed binary blob. */
  nonce_proof: string;
}

interface CoreRpcInfo {
  burn_block_height: number;
  burn_consensus: string;
  exit_at_block_height: number | null;
  network_id: number;
  parent_network_id: number;
  peer_version: number;
  server_version: string;
  stable_burn_block_height: number;
  stable_burn_consensus: string;
  stacks_tip: string;
  stacks_tip_burn_block: string;
  stacks_tip_height: number;
  unanchored_tip: string;
}

interface CoreRpcPoxInfo {
  contract_id: string;
  first_burnchain_block_height: number;
  min_amount_ustx: number;
  registration_window_length: number;
  rejection_fraction: number;
  reward_cycle_id: number;
  reward_cycle_length: number;
}

export interface Neighbor {
  network_id: number;
  peer_version: number;
  ip: string;
  port: number;
  public_key_hash: string;
  authenticated: boolean;
}

interface CoreRpcNeighbors {
  sample: Neighbor[];
  inbound: Neighbor[];
  outbound: Neighbor[];
}

type RequestOpts = RequestInit & { queryParams?: Record<string, string>; endpoint?: string };

/**
 * Check for any extra endpoints that have been configured for performing a "multicast" for a tx submission.
 */
export async function getExtraTxPostEndpoints(): Promise<string[] | false> {
  const STACKS_API_EXTRA_TX_ENDPOINTS_FILE_ENV_VAR = 'STACKS_API_EXTRA_TX_ENDPOINTS_FILE';
  const extraEndpointsEnvVar = process.env[STACKS_API_EXTRA_TX_ENDPOINTS_FILE_ENV_VAR];
  if (!extraEndpointsEnvVar) {
    return false;
  }
  const filePath = path.resolve(REPO_DIR, extraEndpointsEnvVar);
  let fileContents: string;
  try {
    fileContents = await fs.promises.readFile(filePath, { encoding: 'utf8' });
  } catch (error) {
    logError(`Error reading ${STACKS_API_EXTRA_TX_ENDPOINTS_FILE_ENV_VAR}: ${error}`, error);
    return false;
  }
  const endpoints = fileContents
    .split(/\r?\n/)
    .map(r => r.trim())
    .filter(r => !r.startsWith('#') && r.length !== 0);
  if (endpoints.length === 0) {
    return false;
  }
  return endpoints;
}

export function getCoreNodeEndpoint(opts?: { host?: string; port?: number | string }) {
  const host = opts?.host ?? process.env['STACKS_CORE_RPC_HOST'];
  if (!host) {
    throw new Error(`STACKS_CORE_RPC_HOST is not defined`);
  }
  const port = parsePort(opts?.port ?? process.env['STACKS_CORE_RPC_PORT']);
  if (!port) {
    throw new Error(`STACKS_CORE_RPC_PORT is not defined`);
  }
  return `${host}:${port}`;
}

/**
 * Returns a normalized http or https URL.
 * Adds `http://` if not specified.
 * Adds default http or https ports if not specified.
 */
function getUrl(endpoint: string) {
  let url: URL;
  if (!endpoint.startsWith('http:') || !endpoint.startsWith('https:')) {
    url = new URL('http://' + endpoint);
  } else {
    url = new URL(endpoint);
  }
  if (!url.port) {
    if (url.protocol === 'https:') {
      url.port = '433';
    } else if (url.protocol === 'http:') {
      url.port = '80';
    }
  }
  return url;
}

export class StacksCoreRpcClient {
  readonly endpoint: string;

  constructor(opts?: { host?: string; port?: number | string }) {
    this.endpoint = getCoreNodeEndpoint(opts);
  }

  createUrl(path: string, init?: RequestOpts) {
    let url: URL;
    if (init?.endpoint) {
      url = getUrl(init.endpoint);
      // Use `path` arg if not already specified in the endpoint itself
      if (url.pathname === '/') {
        url.pathname = '/' + path;
      }
    } else {
      url = new URL(`http://${this.endpoint}/${path}`);
    }
    if (init?.queryParams) {
      Object.entries(init.queryParams).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return url.toString();
  }

  /**
   * Try connecting to the endpoint until successful for timeout is reached.
   * Throws an error if connection cannot be established.
   * @param retryTimeout - milliseconds
   */
  async waitForConnection(retryTimeout = 30000): Promise<void> {
    const retryInterval = 1000; // 1 second
    const timer = stopwatch();
    let lastError: Error;
    do {
      try {
        const info = await this.getInfo();
        if (!info.stacks_tip_height || info.stacks_tip_height <= 0) {
          throw new Error(`stacks_tip_height not >= 1`);
        }
        return;
      } catch (error: any) {
        lastError = error;
        await timeout(retryInterval);
      }
    } while (timer.getElapsed() < retryTimeout);
    throw lastError;
  }

  async fetchJson<T>(path: string, init?: RequestOpts): Promise<T> {
    const resultString = await this.fetchText(path, init);
    try {
      const resultJson = JSON.parse(resultString);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return resultJson;
    } catch (error) {
      logError(`Error parsing json: "${resultString}"`, error);
      throw error;
    }
  }

  async fetchText(path: string, init?: RequestOpts): Promise<string> {
    const url = this.createUrl(path, init);
    const result = await fetch(url, init);
    if (!result.ok) {
      let msg = '';
      try {
        msg = await result.text();
      } catch (error) {
        // ignore error
      }
      throw new Error(`Response ${result.status}: ${result.statusText} fetching ${url} - ${msg}`);
    }
    try {
      const resultString = await result.text();
      return resultString;
    } catch (error) {
      logError(`Error reading response from ${url}`, error);
      throw error;
    }
  }

  async getInfo(): Promise<CoreRpcInfo> {
    const result = await this.fetchJson<CoreRpcInfo>('v2/info');
    return result;
  }

  async getPox(): Promise<CoreRpcPoxInfo> {
    const result = await this.fetchJson<CoreRpcPoxInfo>('v2/pox');
    return result;
  }

  async getAccount(
    principal: string,
    atUnanchoredChainTip = false,
    indexBlockHash?: string
  ): Promise<CoreRpcAccountInfo> {
    const requestOpts: RequestOpts = {
      method: 'GET',
      queryParams: {
        proof: '0',
      },
    };
    if (atUnanchoredChainTip) {
      const info = await this.getInfo();
      requestOpts.queryParams!.tip = info.unanchored_tip;
    } else if (indexBlockHash) {
      requestOpts.queryParams!.tip = indexBlockHash;
    }
    const result = await this.fetchJson<CoreRpcAccountInfo>(
      `v2/accounts/${principal}`,
      requestOpts
    );
    return result;
  }

  async getAccountNonce(principal: string, atUnanchoredChainTip = false): Promise<number> {
    const nonces: number[] = [];
    const lookups: Promise<number>[] = [
      this.getAccount(principal, false).then(account => nonces.push(account.nonce)),
    ];
    if (atUnanchoredChainTip) {
      lookups.push(this.getAccount(principal, true).then(account => nonces.push(account.nonce)));
    }
    await Promise.allSettled(lookups);
    if (nonces.length === 0) {
      await lookups[0];
    }
    const nonce = Math.max(...nonces);
    return nonce;
  }

  async getAccountBalance(principal: string): Promise<BigInt> {
    const account = await this.getAccount(principal);
    const balance = BigInt(account.balance);
    return balance;
  }

  async sendTransaction(serializedTx: Buffer): Promise<{ txId: string }> {
    const result = await this.fetchJson<string>('v2/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: serializedTx,
    });
    return {
      txId: '0x' + result,
    };
  }

  async multicastTransaction(
    serializedTx: Buffer
  ): Promise<{
    txId: string | undefined;
    errors: {
      endpoint: string;
      error: Error;
    }[];
  }> {
    const extraEndpoints = await getExtraTxPostEndpoints();
    if (!extraEndpoints) {
      const result = await this.sendTransaction(serializedTx);
      return {
        txId: result.txId,
        errors: [],
      };
    }
    const endpoints = [
      // The primary proxy endpoint (the http response from this one will be returned to the client)
      this.createUrl('v2/transactions'),
      ...extraEndpoints.map(e => this.createUrl('v2/transactions', { endpoint: e })),
    ];
    // Remove dupes
    for (let i = endpoints.length - 1; i >= 0; i--) {
      for (let f = endpoints.length - 1; f >= 0; f--) {
        if (f !== i && endpoints[i] === endpoints[f]) {
          endpoints.splice(f, 1);
        }
      }
    }
    const requests = endpoints.map(endpoint => {
      return this.fetchJson<string>('v2/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: serializedTx,
        endpoint: endpoint,
      });
    });
    const results = await Promise.allSettled(requests);
    let txId: string | undefined;
    if (results[0].status === 'fulfilled') {
      txId = '0x' + results[0].value;
    }

    const errors = results
      .filter((p): p is PromiseRejectedResult => p.status === 'rejected')
      .map((p, index) => ({ endpoint: endpoints[index], error: p.reason as Error }));

    return {
      txId: txId,
      errors: errors,
    };
  }

  async getNeighbors(): Promise<CoreRpcNeighbors> {
    const result = await this.fetchJson<CoreRpcNeighbors>(`v2/neighbors`, {
      method: 'GET',
    });
    return result;
  }

  async getEstimatedTransferFee(): Promise<CoreNodeFeeResponse> {
    const result = await this.fetchJson<CoreNodeFeeResponse>(`v2/fees/transfer`, {
      method: 'GET',
    });
    return result;
  }
}
