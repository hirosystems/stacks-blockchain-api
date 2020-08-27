import fetch, { RequestInit } from 'node-fetch';
import { parsePort, stopwatch, logError, timeout } from '../helpers';

export interface CoreRpcAccountInfo {
  /** Hex-prefixed uint128. */
  balance: string;
  /** Hex-prefixed binary blob. */
  balance_proof: string;
  nonce: number;
  /** Hex-prefixed binary blob. */
  nonce_proof: string;
}

export interface CoreRpcInfo {
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
}

export interface Neighbor {
  network_id: number;
  peer_version: number;
  ip: string;
  port: number;
  public_key_hash: string;
  authenticated: boolean;
}

export interface CoreRpcNeighbors {
  sample: Neighbor[];
  inbound: Neighbor[];
  outbound: Neighbor[];
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

export class StacksCoreRpcClient {
  readonly endpoint: string;

  constructor(opts?: { host?: string; port?: number | string }) {
    this.endpoint = getCoreNodeEndpoint(opts);
  }

  createUrl(path: string) {
    return `http://${this.endpoint}/${path}`;
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
      } catch (error) {
        lastError = error;
        await timeout(retryInterval);
      }
    } while (timer.getElapsed() < retryTimeout);
    throw lastError;
  }

  async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const url = this.createUrl(path);
    const resultString = await this.fetchText(path, init);
    try {
      const resultJson = JSON.parse(resultString);
      return resultJson;
    } catch (error) {
      logError(`Error parsing json from ${url}: "${resultString}"`, error);
      throw error;
    }
  }

  async fetchText(path: string, init?: RequestInit): Promise<string> {
    const url = this.createUrl(path);
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

  async getAccount(principal: string): Promise<CoreRpcAccountInfo> {
    const result = await this.fetchJson<CoreRpcAccountInfo>(`v2/accounts/${principal}`, {
      method: 'GET',
    });
    return result;
  }

  async getAccountNonce(principal: string): Promise<number> {
    const account = await this.getAccount(principal);
    return account.nonce;
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

  async getNeighbors(): Promise<CoreRpcNeighbors> {
    const result = await this.fetchJson<CoreRpcNeighbors>(`v2/neighbors`, {
      method: 'GET',
    });
    return result;
  }
}
