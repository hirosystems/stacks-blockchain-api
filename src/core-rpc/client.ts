/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fetch, { RequestInit } from 'node-fetch';
import { parsePort } from '../helpers';
import { ClarityValue, cvToHex } from '@stacks/transactions';
import { logger } from '../logger';
import { stopwatch, timeout } from '@hirosystems/api-toolkit';

interface CoreRpcAccountInfo {
  /** Hex-prefixed uint128. */
  balance: string;
  /** Hex-prefixed binary blob. */
  balance_proof: string;
  locked: string;
  nonce: number;
  /** Hex-prefixed binary blob. */
  nonce_proof: string;
  unlock_height: number;
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

export interface CoreRpcPoxInfo {
  contract_id: string;
  pox_activation_threshold_ustx: number;
  first_burnchain_block_height: number;
  prepare_phase_block_length: number;
  reward_phase_block_length: number;
  reward_slots: number;
  rejection_fraction: number;
  total_liquid_supply_ustx: number;
  current_cycle: {
    id: number;
    min_threshold_ustx: number;
    stacked_ustx: number;
    is_pox_active: boolean;
  };
  next_cycle: {
    id: number;
    min_threshold_ustx: number;
    min_increment_ustx: number;
    stacked_ustx: number;
    prepare_phase_start_block_height: number;
    blocks_until_prepare_phase: number;
    reward_phase_start_block_height: number;
    blocks_until_reward_phase: number;
    ustx_until_pox_rejection: number;
  };
  epochs: {
    epoch_id: string;
    start_height: number;
    end_height: number;
    block_limit: {
      write_length: number;
      write_count: number;
      read_length: number;
      read_count: number;
      runtime: number;
    };
    network_epoch: number;
  }[];

  /** @deprecated included for backwards-compatibility */
  min_amount_ustx: number;
  /** @deprecated included for backwards-compatibility */
  prepare_cycle_length: number;
  /** @deprecated included for backwards-compatibility */
  reward_cycle_id: number;
  /** @deprecated included for backwards-compatibility */
  reward_cycle_length: number;
  /** @deprecated included for backwards-compatibility */
  rejection_votes_left_required: number;
  /** @deprecated included for backwards-compatibility */
  next_reward_cycle_in: number;

  // Available in Stacks 2.1:
  current_burnchain_block_height?: number;
  contract_versions?: {
    contract_id: string;
    activation_burnchain_block_height: number;
    first_reward_cycle_id: number;
  }[];
}

export interface Neighbor {
  network_id: number;
  peer_version: number;
  ip: string;
  port: number;
  public_key_hash: string;
  authenticated: boolean;
}

interface ReadOnlyContractCallSuccessResponse {
  okay: true;
  result: string;
}

interface ReadOnlyContractCallFailResponse {
  okay: false;
  cause: string;
}

export type ReadOnlyContractCallResponse =
  | ReadOnlyContractCallSuccessResponse
  | ReadOnlyContractCallFailResponse;

interface CoreRpcNeighbors {
  sample: Neighbor[];
  inbound: Neighbor[];
  outbound: Neighbor[];
}

type RequestOpts = RequestInit & { queryParams?: Record<string, string> };

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

  createUrl(path: string, init?: RequestOpts) {
    const url = new URL(`http://${this.endpoint}/${path}`);
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
  async waitForConnection(retryTimeout = 60000): Promise<void> {
    const retryInterval = 2500; // 2.5 seconds
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
      logger.error(error, `Error parsing json: "${resultString}"`);
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
      logger.error(error, `Error reading response from ${url}`);
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

  async getAccountBalance(principal: string): Promise<bigint> {
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

  async sendReadOnlyContractCall(
    contractAddress: string,
    contractName: string,
    functionName: string,
    senderAddress: string,
    functionArgs: ClarityValue[]
  ): Promise<ReadOnlyContractCallResponse> {
    const body = {
      sender: senderAddress,
      arguments: functionArgs.map(arg => cvToHex(arg)),
    };
    return await this.fetchJson<ReadOnlyContractCallResponse>(
      `v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  }

  async getNeighbors(): Promise<CoreRpcNeighbors> {
    const result = await this.fetchJson<CoreRpcNeighbors>(`v2/neighbors`, {
      method: 'GET',
    });
    return result;
  }
}
