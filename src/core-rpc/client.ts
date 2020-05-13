import fetch, { RequestInit } from 'node-fetch';
import { parsePort, stopwatch, logError } from '../helpers';

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
  peer_version: number;
  burn_consensus: string;
  burn_block_height: number;
  stable_burn_consensus: string;
  stable_burn_block_height: number;
  server_version: string;
  network_id: number;
  parent_network_id: number;
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
   * @param timeout - milliseconds
   */
  async waitForConnection(timeout = 30000): Promise<void> {
    const timer = stopwatch();
    let lastError: Error;
    do {
      try {
        await this.getInfo();
        await this.getAccountNonce('ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH');
        return;
      } catch (error) {
        lastError = error;
      }
    } while (timer.getElapsed() < timeout);
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
}
