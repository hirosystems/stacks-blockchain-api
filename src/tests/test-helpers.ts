import { I32_MAX } from '../helpers';
import {
  DataStoreBlockUpdateData,
  DbEventTypeId,
  DbMempoolTx,
  DbTxTypeId,
} from '../datastore/common';
import { bufferCVFromString, serializeCV, uintCV } from '@stacks/transactions';
import { createClarityValueArray } from '../p2p/tx';

// Hack to avoid jest outputting 'Your test suite must contain at least one test.'
// https://stackoverflow.com/a/59864054/794962
test.skip('test-ignore-kludge', () => 1);

type Disposable<T> = () =>
  | readonly [item: T, dispose: () => any | Promise<any>]
  | Promise<readonly [item: T, dispose: () => any | Promise<any>]>;

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type UnwrapDisposable<T> = T extends Disposable<infer U> ? UnwrapPromise<U> : never;

type UnwrapDisposables<T extends [...any[]]> = T extends [infer Head, ...infer Tail]
  ? [UnwrapDisposable<Head>, ...UnwrapDisposables<Tail>]
  : [];

export async function useWithCleanup<T extends [...Disposable<any>[]]>(
  ...args: [...using: T, fn: (...items: UnwrapDisposables<T>) => unknown | Promise<unknown>]
) {
  const disposables = args.slice(0, -1) as Disposable<unknown>[];
  const cb = args[args.length - 1] as (...items: unknown[]) => unknown;
  const items: unknown[] = [];
  const cleanups: (() => unknown | Promise<unknown>)[] = [];
  for (const using of disposables) {
    const run = using();
    const [item, cleanup] = run instanceof Promise ? await run : run;
    items.push(item);
    cleanups.push(cleanup);
  }
  try {
    const run = cb(...items);
    run instanceof Promise && (await run);
  } finally {
    for (const cleanup of cleanups) {
      const run = cleanup();
      run instanceof Promise && (await run);
    }
  }
}

type TestEnvVar = [EnvVarKey: string, EnvVarValue: string];

/**
 * Helper function for tests.
 * Sets local process environment variables, and returns a function that restores them to the original values.
 */
export function withEnvVars(...envVars: TestEnvVar[]) {
  const original: { exists: boolean; key: string; value: string | undefined }[] = [];
  envVars.forEach(([k, v]) => {
    original.push({
      exists: k in process.env,
      key: k,
      value: v,
    });
  });
  envVars.forEach(([k, v]) => {
    process.env[k] = v;
  });
  return () => {
    original.forEach(orig => {
      if (!orig.exists) {
        delete process.env[orig.key];
      } else {
        process.env[orig.key] = orig.value;
      }
    });
  };
}

/**
 * Builder that creates a test block with any number of transactions and events so populating
 * the DB for testing becomes way easier.
 *
 * The output of `build()` can be used in a `db.update()` call to process the block just as
 * if it came from the Event Server.
 */
export class TestBlockBuilder {
  // Default values when none given.
  public static readonly SENDER_ADDRESS = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
  public static readonly CONTRACT_ID = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
  public static readonly CONTRACT_ABI = {
    maps: [],
    functions: [
      {
        args: [{ type: 'uint128', name: 'amount' }],
        name: 'test-contract-fn',
        access: 'public',
        outputs: {
          type: {
            response: {
              ok: 'uint128',
              error: 'none',
            },
          },
        },
      },
    ],
    variables: [],
    fungible_tokens: [],
    non_fungible_tokens: [],
  };
  public static readonly CONTRACT_SOURCE = '(some-contract-src)';
  public static readonly CONTRACT_CALL_FUNCTION_NAME = 'test-contract-fn';

  private data: DataStoreBlockUpdateData;
  private txIndex = 0;

  constructor(args?: { block_height?: number; block_hash?: string }) {
    this.data = {
      block: {
        block_hash: args?.block_hash ?? '0x1234',
        index_block_hash: '0xdeadbeef',
        parent_index_block_hash: '0x00',
        parent_block_hash: '0xff0011',
        parent_microblock_hash: '',
        block_height: args?.block_height ?? 1,
        burn_block_time: 94869286,
        burn_block_hash: '0x1234',
        burn_block_height: 123,
        miner_txid: '0x4321',
        canonical: true,
        parent_microblock_sequence: 0,
        execution_cost_read_count: 0,
        execution_cost_read_length: 0,
        execution_cost_runtime: 0,
        execution_cost_write_count: 0,
        execution_cost_write_length: 0,
      },
      microblocks: [],
      minerRewards: [],
      txs: [],
    };
  }

  addTx(args?: {
    sender_address?: string;
    type_id?: DbTxTypeId;
    tx_id?: string;
  }): TestBlockBuilder {
    this.data.txs.push({
      tx: {
        tx_id: args?.tx_id ?? '0x01',
        tx_index: 0,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: Buffer.alloc(0),
        index_block_hash: this.data.block.index_block_hash,
        block_hash: this.data.block.block_hash,
        block_height: this.data.block.block_height,
        burn_block_time: this.data.block.burn_block_time,
        parent_burn_block_time: 1626122935,
        type_id: args?.type_id ?? DbTxTypeId.Coinbase,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical: true,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: args?.sender_address ?? TestBlockBuilder.SENDER_ADDRESS,
        origin_hash_mode: 1,
        coinbase_payload: Buffer.from('hi'),
        event_count: 1,
        parent_index_block_hash: '',
        parent_block_hash: '',
        microblock_canonical: true,
        microblock_sequence: I32_MAX,
        microblock_hash: '',
        execution_cost_read_count: 0,
        execution_cost_read_length: 0,
        execution_cost_runtime: 0,
        execution_cost_write_count: 0,
        execution_cost_write_length: 0,
      },
      stxLockEvents: [],
      stxEvents: [],
      ftEvents: [],
      nftEvents: [],
      contractLogEvents: [],
      smartContracts: [],
      names: [],
      namespaces: [],
    });
    this.txIndex = this.data.txs.length - 1;
    return this;
  }

  addTxContractLogEvent(args?: { contract_identifier?: string }): TestBlockBuilder {
    this.data.txs[this.txIndex].contractLogEvents.push({
      event_index: 4,
      tx_id: this.data.txs[this.txIndex].tx.tx_id,
      tx_index: 0,
      block_height: this.data.block.block_height,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: args?.contract_identifier ?? TestBlockBuilder.CONTRACT_ID,
      topic: 'some-topic',
      value: serializeCV(bufferCVFromString('some val')),
    });
    return this;
  }

  addTxSmartContract(args?: { contract_id?: string; abi?: string }): TestBlockBuilder {
    this.data.txs[this.txIndex].smartContracts.push({
      tx_id: this.data.txs[this.txIndex].tx.tx_id,
      canonical: true,
      block_height: this.data.block.block_height,
      contract_id: args?.contract_id ?? TestBlockBuilder.CONTRACT_ID,
      source_code: TestBlockBuilder.CONTRACT_SOURCE,
      abi: args?.abi ?? JSON.stringify(TestBlockBuilder.CONTRACT_ABI),
    });
    return this;
  }

  build(): DataStoreBlockUpdateData {
    return this.data;
  }
}

export class TestMempoolTxBuilder {
  data: DbMempoolTx;

  constructor(args?: {
    type_id?: DbTxTypeId;
    sender_address?: string;
    tx_id?: string;
    smart_contract_contract_id?: string;
    contract_call_contract_id?: string;
    contract_call_function_name?: string;
    contract_call_function_args?: Buffer;
  }) {
    this.data = {
      pruned: false,
      tx_id: args?.tx_id ?? `0x1234`,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: args?.type_id ?? DbTxTypeId.TokenTransfer,
      receipt_time: (new Date().getTime() / 1000) | 0,
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      origin_hash_mode: 1,
      sender_address: args?.sender_address ?? TestBlockBuilder.SENDER_ADDRESS,
      token_transfer_amount: 1234n,
      token_transfer_memo: Buffer.alloc(0),
      smart_contract_contract_id: args?.smart_contract_contract_id ?? TestBlockBuilder.CONTRACT_ID,
      contract_call_contract_id: args?.contract_call_contract_id ?? TestBlockBuilder.CONTRACT_ID,
      contract_call_function_name:
        args?.contract_call_function_name ?? TestBlockBuilder.CONTRACT_CALL_FUNCTION_NAME,
      contract_call_function_args:
        args?.contract_call_function_args ?? createClarityValueArray(uintCV(123456)),
    };
  }

  build(): DbMempoolTx {
    return this.data;
  }
}
