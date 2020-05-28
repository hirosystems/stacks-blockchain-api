import {
  makeContractCall,
  NonFungibleConditionCode,
  FungibleConditionCode,
  bufferCVFromString,
  ClarityAbi,
  ClarityType,
} from '@blockstack/stacks-transactions';
import {
  createNonFungiblePostCondition,
  createFungiblePostCondition,
  createSTXPostCondition,
} from '@blockstack/stacks-transactions/lib/postcondition';
import * as BN from 'bn.js';
import { readTransaction } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { getTxFromDataStore, getBlockFromDataStore } from '../api/controllers/db-controller';
import { MemoryDataStore } from '../datastore/memory-store';
import { createDbTxFromCoreMsg, DbBlock, DbTx, DbTxTypeId } from '../datastore/common';

describe('api tests', () => {
  let db: MemoryDataStore;

  beforeEach(() => {
    db = new MemoryDataStore();
  });

  describe('getTxList()', () => {
    test('it returns object', async () => {
      expect(await db.getTxList({ limit: 10, offset: 0 })).toEqual({ results: [], total: 0 });
    });
  });

  test('block store and process', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
      burn_block_time: 94869286,
      canonical: true,
    };
    await db.updateBlock(block);
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(tx);

    const blockQuery = await getBlockFromDataStore(block.block_hash, db);
    if (!blockQuery.found) {
      throw new Error('block not found');
    }

    const expectedResp = {
      burn_block_time: 94869286,
      canonical: true,
      hash: '0x1234',
      height: 1235,
      parent_block_hash: '0xff0011',
      txs: ['0x1234'],
    };

    expect(blockQuery.result).toEqual(expectedResp);
  });

  test('tx store and processing', async () => {
    const pc1 = createNonFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      NonFungibleConditionCode.Owns,
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello::asset-name',
      bufferCVFromString('asset-value')
    );

    const pc2 = createFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.GreaterEqual,
      new BN(123456),
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello-ft::asset-name-ft'
    );

    const pc3 = createSTXPostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.LessEqual,
      new BN(36723458)
    );

    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: new BN(556) }],
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [pc1, pc2, pc3],
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        success: true,
        txid: txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      index_block_hash: 'aa',
      block_hash: 'ff',
      block_height: 123,
      burn_block_time: 345,
    });
    await db.updateTx(dbTx);
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    await db.updateSmartContract(dbTx, {
      tx_id: dbTx.tx_id,
      canonical: true,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: 123,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    });
    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: 'ff',
      block_height: 123,
      burn_block_time: 345,
      canonical: true,
      tx_id: 'c3e2fabaf7017fa2f6967db4f21be4540fdeae2d593af809c18a6adf369bfb03',
      tx_index: 2,
      tx_status: 'success',
      tx_type: 'contract_call',
      fee_rate: '200',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [
        {
          type: 'non_fungible',
          condition_code: 'not_sent',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello',
            asset_name: 'asset-name',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
          asset_value: { hex: '0x020000000b61737365742d76616c7565', repr: '"asset-value"' },
        },
        {
          type: 'fungible',
          condition_code: 'sent_greater_than',
          amount: '123456',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello-ft',
            asset_name: 'asset-name-ft',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
        },
        {
          type: 'stx',
          condition_code: 'sent_less_than',
          amount: '36723458',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
        },
      ],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);
  });
});
