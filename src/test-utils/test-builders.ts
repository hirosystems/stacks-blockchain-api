/**
 * This file provides builders and helper functions for generating sample blocks, microblocks, transactions,
 * and events.
 *
 * Use of these builders is encouraged in every test that requires the blockchain to be in a
 * specific state as opposed to writing data to individual tables directly, as that could lead to tests
 * not being representative of a real life scenario.
 */
import {
  DataStoreBlockUpdateData,
  DataStoreMicroblockUpdateData,
  DataStoreTxEventData,
  DbAssetEventTypeId,
  DbBlock,
  DbEventTypeId,
  DbMempoolTx,
  DbMicroblockPartial,
  DbNftEvent,
  DbSmartContract,
  DbSmartContractEvent,
  DbStxEvent,
  DbTxStatus,
  DbTxTypeId,
} from '../datastore/common';
import { bufferCV, bufferCVFromString, intCV, serializeCV, uintCV } from '@stacks/transactions';
import { createClarityValueArray } from '../p2p/tx';

// Default values when none given. Useful when they are irrelevant for a particular test.
const BLOCK_HEIGHT = 1;
const BLOCK_HASH = '0x123456';
const INDEX_BLOCK_HASH = '0xdeadbeef';
const MICROBLOCK_HASH = '0x123466';
const BURN_BLOCK_HASH = '0xf44f44';
const BURN_BLOCK_HEIGHT = 713000;
const BURN_BLOCK_TIME = 94869286;
const SENDER_ADDRESS = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
const RECIPIENT_ADDRESS = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
const TOKEN_TRANSFER_AMOUNT = 100n;
const FEE_RATE = 50n;
const TX_ID = '0x1234';
const ASSET_IDENTIFIER = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy';
const CONTRACT_ID = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
const CONTRACT_SOURCE = '(some-contract-src)';
const CONTRACT_CALL_FUNCTION_NAME = 'test-contract-fn';
const CONTRACT_ABI = {
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

interface TestBlockArgs {
  block_height?: number;
  block_hash?: string;
  index_block_hash?: string;
  burn_block_hash?: string;
  parent_index_block_hash?: string;
  parent_block_hash?: string;
  parent_microblock_hash?: string;
  parent_microblock_sequence?: number;
}

/**
 * Generate a test block.
 * @param args - Optional block data
 * @returns `DbBlock`
 */
function testBlock(args?: TestBlockArgs): DbBlock {
  return {
    block_hash: args?.block_hash ?? BLOCK_HASH,
    index_block_hash: args?.index_block_hash ?? INDEX_BLOCK_HASH,
    parent_index_block_hash: args?.parent_index_block_hash ?? '',
    parent_block_hash: args?.parent_block_hash ?? '',
    parent_microblock_hash: args?.parent_microblock_hash ?? '',
    parent_microblock_sequence: args?.parent_microblock_sequence ?? 0,
    block_height: args?.block_height ?? BLOCK_HEIGHT,
    burn_block_time: BURN_BLOCK_TIME,
    burn_block_hash: args?.burn_block_hash ?? BURN_BLOCK_HASH,
    burn_block_height: BURN_BLOCK_HEIGHT,
    miner_txid: '0x4321',
    canonical: true,
    execution_cost_read_count: 0,
    execution_cost_read_length: 0,
    execution_cost_runtime: 0,
    execution_cost_write_count: 0,
    execution_cost_write_length: 0,
  };
}

interface TestMicroblockArgs {
  microblock_hash?: string;
  microblock_parent_hash?: string;
  microblock_sequence?: number;
  parent_index_block_hash?: string;
}

/**
 * Generate a test microblock.
 * @param args - Optional microblock data
 * @returns `DbMicroblockPartial`
 */
function testMicroblock(args?: TestMicroblockArgs): DbMicroblockPartial {
  return {
    microblock_hash: args?.microblock_hash ?? MICROBLOCK_HASH,
    microblock_sequence: args?.microblock_sequence ?? 0,
    microblock_parent_hash: args?.microblock_parent_hash ?? BLOCK_HASH,
    parent_index_block_hash: args?.parent_index_block_hash ?? INDEX_BLOCK_HASH,
    parent_burn_block_height: BURN_BLOCK_HEIGHT,
    parent_burn_block_hash: BURN_BLOCK_HASH,
    parent_burn_block_time: BURN_BLOCK_TIME,
  };
}

interface TestTxArgs {
  block_hash?: string;
  block_height?: number;
  burn_block_time?: number;
  canonical?: boolean;
  microblock_canonical?: boolean;
  fee_rate?: bigint;
  index_block_hash?: string;
  microblock_hash?: string;
  microblock_sequence?: number;
  parent_index_block_hash?: string;
  raw_result?: string;
  sender_address?: string;
  smart_contract_contract_id?: string;
  status?: DbTxStatus;
  token_transfer_amount?: bigint;
  token_transfer_recipient_address?: string;
  tx_id?: string;
  tx_index?: number;
  type_id?: DbTxTypeId;
  nonce?: number;
}

/**
 * Generate a test transaction.
 * @param args - Optional transaction data
 * @returns `DataStoreTxEventData`
 */
function testTx(args?: TestTxArgs): DataStoreTxEventData {
  return {
    tx: {
      tx_id: args?.tx_id ?? TX_ID,
      tx_index: args?.tx_index ?? 0,
      anchor_mode: 3,
      nonce: args?.nonce ?? 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: args?.index_block_hash ?? INDEX_BLOCK_HASH,
      block_hash: args?.block_hash ?? BLOCK_HASH,
      block_height: args?.block_height ?? BLOCK_HEIGHT,
      burn_block_time: args?.burn_block_time ?? BURN_BLOCK_TIME,
      parent_burn_block_time: BURN_BLOCK_TIME,
      type_id: args?.type_id ?? DbTxTypeId.Coinbase,
      status: args?.status ?? DbTxStatus.Success,
      raw_result: args?.raw_result ?? '0x0703',
      canonical: args?.canonical ?? true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: args?.fee_rate ?? FEE_RATE,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: args?.sender_address ?? SENDER_ADDRESS,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 0,
      parent_index_block_hash: args?.parent_index_block_hash ?? INDEX_BLOCK_HASH,
      parent_block_hash: BLOCK_HASH,
      microblock_canonical: args?.microblock_canonical ?? true,
      microblock_sequence: args?.microblock_sequence ?? 0,
      microblock_hash: args?.microblock_hash ?? MICROBLOCK_HASH,
      token_transfer_amount: args?.token_transfer_amount ?? TOKEN_TRANSFER_AMOUNT,
      token_transfer_recipient_address: args?.token_transfer_recipient_address ?? RECIPIENT_ADDRESS,
      smart_contract_contract_id: args?.smart_contract_contract_id,
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
  };
}

interface TestMempoolTxArgs {
  contract_call_contract_id?: string;
  contract_call_function_args?: Buffer;
  contract_call_function_name?: string;
  pruned?: boolean;
  sender_address?: string;
  smart_contract_contract_id?: string;
  status?: DbTxStatus;
  token_transfer_recipient_address?: string;
  tx_id?: string;
  type_id?: DbTxTypeId;
  nonce?: number;
}

/**
 * Generate a test mempool transaction.
 * @param args - Optional transaction data
 * @returns `DbMempoolTx`
 */
export function testMempoolTx(args?: TestMempoolTxArgs): DbMempoolTx {
  return {
    pruned: args?.pruned ?? false,
    tx_id: args?.tx_id ?? TX_ID,
    anchor_mode: 3,
    nonce: args?.nonce ?? 0,
    raw_tx: Buffer.from('test-raw-tx'),
    type_id: args?.type_id ?? DbTxTypeId.TokenTransfer,
    receipt_time: (new Date().getTime() / 1000) | 0,
    status: args?.status ?? DbTxStatus.Pending,
    post_conditions: Buffer.from([0x01, 0xf5]),
    fee_rate: 1234n,
    sponsored: false,
    sponsor_address: undefined,
    origin_hash_mode: 1,
    sender_address: args?.sender_address ?? SENDER_ADDRESS,
    token_transfer_amount: 1234n,
    token_transfer_memo: Buffer.alloc(0),
    token_transfer_recipient_address: args?.token_transfer_recipient_address ?? RECIPIENT_ADDRESS,
    smart_contract_contract_id: args?.smart_contract_contract_id ?? CONTRACT_ID,
    contract_call_contract_id: args?.contract_call_contract_id ?? CONTRACT_ID,
    contract_call_function_name: args?.contract_call_function_name ?? CONTRACT_CALL_FUNCTION_NAME,
    contract_call_function_args:
      args?.contract_call_function_args ?? createClarityValueArray(uintCV(123456)),
  };
}

interface TestStxEventArgs {
  amount?: bigint;
  block_height?: number;
  event_index?: number;
  recipient?: string;
  sender?: string;
  tx_id?: string;
  tx_index?: number;
}

/**
 * Generate a test stx event.
 * @param args - Optional event data
 * @returns `DbStxEvent`
 */
function testStxEvent(args?: TestStxEventArgs): DbStxEvent {
  return {
    canonical: true,
    event_type: DbEventTypeId.StxAsset,
    asset_event_type_id: DbAssetEventTypeId.Transfer,
    event_index: args?.event_index ?? 0,
    tx_id: args?.tx_id ?? TX_ID,
    tx_index: args?.tx_index ?? 0,
    block_height: args?.block_height ?? BLOCK_HEIGHT,
    amount: args?.amount ?? TOKEN_TRANSFER_AMOUNT,
    recipient: args?.recipient ?? RECIPIENT_ADDRESS,
    sender: args?.sender ?? SENDER_ADDRESS,
  };
}

interface TestNftEventArgs {
  asset_event_type_id?: DbAssetEventTypeId;
  asset_identifier?: string;
  block_height?: number;
  canonical?: boolean;
  event_index?: number;
  recipient?: string;
  sender?: string;
  tx_id?: string;
  tx_index?: number;
  value?: Buffer;
}

/**
 * Generate a test nft event.
 * @param args - Optional event data
 * @returns `DbNftEvent`
 */
function testNftEvent(args?: TestNftEventArgs): DbNftEvent {
  return {
    asset_event_type_id: args?.asset_event_type_id ?? DbAssetEventTypeId.Transfer,
    asset_identifier: args?.asset_identifier ?? ASSET_IDENTIFIER,
    block_height: args?.block_height ?? BLOCK_HEIGHT,
    canonical: args?.canonical ?? true,
    event_index: args?.event_index ?? 0,
    event_type: DbEventTypeId.NonFungibleTokenAsset,
    recipient: args?.recipient, // No default as this can be undefined.
    sender: args?.sender, // No default as this can be undefined.
    tx_id: args?.tx_id ?? TX_ID,
    tx_index: args?.tx_index ?? 0,
    value: args?.value ?? serializeCV(bufferCV(Buffer.from([2051]))),
  };
}

interface TestSmartContractLogEventArgs {
  tx_id?: string;
  block_height?: number;
  contract_identifier?: string;
  event_index?: number;
  tx_index?: number;
}

/**
 * Generate a test contract log event.
 * @param args - Optional event data
 * @returns `DbSmartContractEvent`
 */
function testSmartContractLogEvent(args?: TestSmartContractLogEventArgs): DbSmartContractEvent {
  return {
    event_index: args?.event_index ?? 0,
    tx_id: args?.tx_id ?? TX_ID,
    tx_index: args?.tx_index ?? 0,
    block_height: args?.block_height ?? BLOCK_HEIGHT,
    canonical: true,
    event_type: DbEventTypeId.SmartContractLog,
    contract_identifier: args?.contract_identifier ?? CONTRACT_ID,
    topic: 'some-topic',
    value: serializeCV(bufferCVFromString('some val')),
  };
}

interface TestSmartContractEventArgs {
  tx_id?: string;
  block_height?: number;
  contract_id?: string;
  contract_source?: string;
  abi?: string;
}

/**
 * Generate a test smart contract event.
 * @param args - Optional event data
 * @returns `DbSmartContract`
 */
function testSmartContractEvent(args?: TestSmartContractEventArgs): DbSmartContract {
  return {
    tx_id: args?.tx_id ?? TX_ID,
    canonical: true,
    block_height: args?.block_height ?? BLOCK_HEIGHT,
    contract_id: args?.contract_id ?? CONTRACT_ID,
    source_code: args?.contract_source ?? CONTRACT_SOURCE,
    abi: args?.abi ?? JSON.stringify(CONTRACT_ABI),
  };
}

/**
 * Builder that creates a test block with any number of transactions and events so populating
 * the DB for testing becomes easier.
 *
 * The output of `build()` can be used in a `db.update()` call to process the block just as
 * if it came from the Event Server.
 */
export class TestBlockBuilder {
  private data: DataStoreBlockUpdateData;
  private txIndex = -1;
  private eventIndex = -1;

  constructor(args?: TestBlockArgs) {
    this.data = {
      block: testBlock(args),
      microblocks: [],
      minerRewards: [],
      txs: [],
    };
  }

  get block(): DbBlock {
    return this.data.block;
  }

  get txData(): DataStoreTxEventData {
    return this.data.txs[this.txIndex];
  }

  addTx(args?: TestTxArgs): TestBlockBuilder {
    const defaultArgs: TestTxArgs = {
      index_block_hash: this.block.index_block_hash,
      block_hash: this.block.block_hash,
      block_height: this.block.block_height,
      burn_block_time: this.block.burn_block_time,
      tx_index: ++this.txIndex,
    };
    this.data.txs.push(testTx({ ...defaultArgs, ...args }));
    this.eventIndex = -1;
    return this;
  }

  addTxStxEvent(args?: TestStxEventArgs): TestBlockBuilder {
    const defaultArgs: TestStxEventArgs = {
      tx_id: this.txData.tx.tx_id,
      block_height: this.block.block_height,
      tx_index: this.txIndex,
      event_index: ++this.eventIndex,
    };
    this.txData.stxEvents.push(testStxEvent({ ...defaultArgs, ...args }));
    return this;
  }

  addTxNftEvent(args?: TestNftEventArgs): TestBlockBuilder {
    const defaultArgs: TestNftEventArgs = {
      tx_id: this.txData.tx.tx_id,
      block_height: this.block.block_height,
      tx_index: this.txIndex,
      event_index: ++this.eventIndex,
    };
    this.txData.nftEvents.push(testNftEvent({ ...defaultArgs, ...args }));
    return this;
  }

  addTxContractLogEvent(args?: TestSmartContractLogEventArgs): TestBlockBuilder {
    const defaultArgs: TestSmartContractLogEventArgs = {
      tx_id: this.txData.tx.tx_id,
      block_height: this.block.block_height,
      tx_index: this.txIndex,
      event_index: ++this.eventIndex,
    };
    this.txData.contractLogEvents.push(testSmartContractLogEvent({ ...defaultArgs, ...args }));
    return this;
  }

  addTxSmartContract(args?: TestSmartContractEventArgs): TestBlockBuilder {
    const defaultArgs: TestSmartContractEventArgs = {
      tx_id: this.txData.tx.tx_id,
      block_height: this.block.block_height,
    };
    this.txData.smartContracts.push(testSmartContractEvent({ ...defaultArgs, ...args }));
    return this;
  }

  build(): DataStoreBlockUpdateData {
    return this.data;
  }
}

/**
 * Builder that creates a test microblock stream so populating the DB becomes easier.
 *
 * The output of `build()` can be used in a `db.updateMicroblocks()` call to process the
 * microblocks just as if they came from the Event Server.
 */
export class TestMicroblockStreamBuilder {
  private data: DataStoreMicroblockUpdateData;
  private microblockIndex = -1;
  private txIndex = -1;
  private eventIndex = -1;

  constructor() {
    this.data = {
      microblocks: [],
      txs: [],
    };
  }

  get microblock(): DbMicroblockPartial {
    return this.data.microblocks[this.microblockIndex];
  }

  get txData(): DataStoreTxEventData {
    return this.data.txs[this.txIndex];
  }

  addMicroblock(args?: TestMicroblockArgs): TestMicroblockStreamBuilder {
    const defaultArgs: TestMicroblockArgs = {
      microblock_sequence: ++this.microblockIndex,
      microblock_parent_hash:
        this.microblockIndex > 0
          ? this.data.microblocks[this.microblockIndex - 1].microblock_hash
          : '0x00',
    };
    this.data.microblocks.push(testMicroblock({ ...defaultArgs, ...args }));
    return this;
  }

  addTx(args?: TestTxArgs): TestMicroblockStreamBuilder {
    const defaultBlockArgs: TestTxArgs = {
      parent_index_block_hash: this.microblock.parent_index_block_hash,
      microblock_hash: this.microblock.microblock_hash,
      microblock_sequence: this.microblock.microblock_sequence,
      tx_index: ++this.txIndex,
    };
    this.data.txs.push(testTx({ ...defaultBlockArgs, ...args }));
    this.eventIndex = -1;
    return this;
  }

  addTxStxEvent(args?: TestStxEventArgs): TestMicroblockStreamBuilder {
    const defaultArgs: TestStxEventArgs = {
      tx_id: this.txData.tx.tx_id,
      event_index: ++this.eventIndex,
    };
    this.txData.stxEvents.push(testStxEvent({ ...defaultArgs, ...args }));
    return this;
  }

  addTxNftEvent(args?: TestNftEventArgs): TestMicroblockStreamBuilder {
    const defaultArgs: TestNftEventArgs = {
      tx_id: this.txData.tx.tx_id,
      tx_index: this.txIndex,
      event_index: ++this.eventIndex,
    };
    this.txData.nftEvents.push(testNftEvent({ ...defaultArgs, ...args }));
    return this;
  }

  build(): DataStoreMicroblockUpdateData {
    return this.data;
  }
}
