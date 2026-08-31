import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as btc from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { deserializeTransaction } from '@stacks/transactions';

export const ECPair = ECPairFactory(ecc);

/** PoX `min_amount_ustx` reported by the mock Stacks node. */
export const MOCK_POX_MIN_AMOUNT_USTX = 1_000_000_000_000;

/** Middle fee estimation returned by the mock Stacks node (the one tx builders pick). */
export const MOCK_FEE_ESTIMATE = 250;

export interface MockResponse {
  status: number;
  body: unknown;
}

/**
 * A minimal in-process HTTP server which mimics the subset of the stacks-node RPC interface that
 * the STX and sBTC faucets depend on: `/v2/info` (chain ID detection), `/v2/pox` (stacking
 * amounts), `/v2/fees/transaction` (fee estimation during tx building), and `/v2/transactions`
 * (tx broadcast). Point the faucet at it via `STACKS_FAUCET_NODE_HOST`/`STACKS_FAUCET_NODE_PORT`.
 */
export class MockStacksNode {
  /** Raw tx hexes received via `POST /v2/transactions`, in order. */
  readonly receivedTxs: string[] = [];
  /** Override the `/v2/pox` response (default: a valid payload with `MOCK_POX_MIN_AMOUNT_USTX`). */
  poxResponse?: MockResponse;
  /** Override the `/v2/fees/transaction` response (default: a valid 3-tier estimation). */
  feeEstimateResponse?: MockResponse;
  /** Queue of `/v2/transactions` response overrides, consumed one per request. */
  sendTxResponses: MockResponse[] = [];

  private server?: http.Server;
  port = 0;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk as Buffer));
      req.on('end', () => this.handleRequest(req, res, Buffer.concat(chunks)));
    });
    await new Promise<void>(resolve => this.server?.listen(0, '127.0.0.1', resolve));
    this.port = (this.server?.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer): void {
    const path = new URL(req.url as string, `http://127.0.0.1:${this.port}`).pathname;
    if (path === '/v2/info') {
      return sendJson(res, 200, {
        network_id: 0x80000000,
        parent_network_id: 0xff000000,
        burn_block_height: 100,
        stacks_tip_height: 100,
        server_version: 'mock-stacks-node',
      });
    }
    if (path === '/v2/pox') {
      const override = this.poxResponse;
      if (override) return sendJson(res, override.status, override.body);
      return sendJson(res, 200, { min_amount_ustx: MOCK_POX_MIN_AMOUNT_USTX });
    }
    if (path === '/v2/fees/transaction') {
      const override = this.feeEstimateResponse;
      if (override) return sendJson(res, override.status, override.body);
      return sendJson(res, 200, {
        estimations: [
          { fee: MOCK_FEE_ESTIMATE - 100 },
          { fee: MOCK_FEE_ESTIMATE },
          { fee: MOCK_FEE_ESTIMATE + 100 },
        ],
      });
    }
    if (path === '/v2/transactions') {
      // Broadcasts arrive in the JSON body form: `{ tx: <unprefixed tx hex> }`.
      const txHex = (JSON.parse(body.toString('utf8')) as { tx: string }).tx;
      this.receivedTxs.push(txHex);
      const override = this.sendTxResponses.shift();
      if (override) return sendJson(res, override.status, override.body);
      // The real node responds with the txid as a plain JSON string, without a `0x` prefix.
      return sendJson(res, 200, deserializeTransaction(txHex).txid());
    }
    return sendJson(res, 404, { error: `mock stacks node has no handler for ${path}` });
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' && status !== 200 ? body : JSON.stringify(body));
}

export async function startMockStacksNode(): Promise<MockStacksNode> {
  const node = new MockStacksNode();
  await node.start();
  return node;
}

interface StoredBtcTx {
  tx: btc.Transaction;
  height: number;
  coinbase: boolean;
}

/**
 * A minimal in-process JSON-RPC server which mimics the subset of the bitcoind regtest RPC
 * interface that the BTC faucet depends on: `scantxoutset`, `getrawmempool`, `getrawtransaction`,
 * and `sendrawtransaction`, backed by an in-memory UTXO ledger. Point the faucet at it via
 * `BTC_RPC_HOST`/`BTC_RPC_PORT`.
 */
export class MockBitcoinRpc {
  /** Simulated burnchain tip height, used to derive UTXO confirmation counts. */
  chainHeight = 200;
  /** Raw tx hexes received via `sendrawtransaction`, in order. */
  readonly sentRawTxs: string[] = [];

  private txs = new Map<string, StoredBtcTx>();
  private server?: http.Server;
  port = 0;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk as Buffer));
      req.on('end', () => {
        try {
          const { method, params, id } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const result = this.handleRpc(method, params);
          sendJson(res, 200, { result, error: null, id });
        } catch (error) {
          sendJson(res, 500, {
            result: null,
            error: { code: -32603, message: (error as Error).message },
            id: null,
          });
        }
      });
    });
    await new Promise<void>(resolve => this.server?.listen(0, '127.0.0.1', resolve));
    this.port = (this.server?.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }

  /**
   * Funds `address` with a confirmed UTXO by storing a synthetic coinbase-style funding
   * transaction in the ledger. Returns the funding txid.
   */
  seedUtxo(address: string, amountBtc: number, opts?: { height?: number; coinbase?: boolean }) {
    const tx = new btc.Transaction();
    tx.version = 2;
    tx.addInput(Buffer.alloc(32, 0), 0xffffffff);
    tx.addOutput(
      btc.address.toOutputScript(address, btc.networks.regtest),
      BigInt(Math.round(amountBtc * 1e8))
    );
    const txid = tx.getId();
    this.txs.set(txid, { tx, height: opts?.height ?? 100, coinbase: opts?.coinbase ?? false });
    return txid;
  }

  private handleRpc(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case 'scantxoutset':
        return this.scanTxOutSet(params.scanobjects as string[]);
      case 'getrawmempool':
        return [];
      case 'getrawtransaction': {
        const stored = this.txs.get(params.txid as string);
        if (!stored) throw new Error(`No such mempool or blockchain transaction: ${params.txid}`);
        return params.verbose ? { txid: params.txid, hex: stored.tx.toHex() } : stored.tx.toHex();
      }
      case 'sendrawtransaction': {
        const tx = btc.Transaction.fromHex(params.hexstring as string);
        const txid = tx.getId();
        this.sentRawTxs.push(params.hexstring as string);
        // Treat broadcast txs as immediately confirmed so their change outputs are spendable.
        this.txs.set(txid, { tx, height: this.chainHeight - 50, coinbase: false });
        return txid;
      }
      default:
        throw new Error(`mock bitcoind has no handler for method ${method}`);
    }
  }

  private scanTxOutSet(scanObjects: string[]) {
    const address = /^addr\((.+)\)$/.exec(scanObjects[0])?.[1];
    if (!address) throw new Error(`Unsupported scanobjects: ${JSON.stringify(scanObjects)}`);
    const script = Buffer.from(btc.address.toOutputScript(address, btc.networks.regtest));

    const spent = new Set<string>();
    for (const { tx } of this.txs.values()) {
      for (const input of tx.ins) {
        spent.add(`${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`);
      }
    }

    const unspents = [];
    for (const [txid, { tx, height, coinbase }] of this.txs) {
      for (let vout = 0; vout < tx.outs.length; vout++) {
        const output = tx.outs[vout];
        if (!script.equals(Buffer.from(output.script)) || spent.has(`${txid}:${vout}`)) continue;
        unspents.push({
          txid,
          vout,
          scriptPubKey: Buffer.from(output.script).toString('hex'),
          desc: `addr(${address})`,
          amount: Number(output.value) / 1e8,
          coinbase,
          height,
        });
      }
    }
    return {
      success: true,
      height: this.chainHeight,
      bestblock: '00'.repeat(32),
      txouts: unspents.length,
      total_amount: unspents.reduce((total, utxo) => total + utxo.amount, 0),
      unspents,
    };
  }
}

export async function startMockBitcoinRpc(): Promise<MockBitcoinRpc> {
  const rpc = new MockBitcoinRpc();
  await rpc.start();
  return rpc;
}

/** Generates a random regtest BTC address. */
export function makeRandomBtcAddress(
  format: 'p2pkh' | 'p2wpkh' = 'p2pkh',
  network: btc.Network = btc.networks.regtest
): string {
  const pubkey = Buffer.from(ECPair.makeRandom({ network }).publicKey);
  const payment =
    format === 'p2pkh'
      ? btc.payments.p2pkh({ pubkey, network })
      : btc.payments.p2wpkh({ pubkey, network });
  if (!payment.address) throw new Error('address generation failed');
  return payment.address;
}
