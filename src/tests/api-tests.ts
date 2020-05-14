import {
  makeContractCall,
  NonFungibleConditionCode,
  FungibleConditionCode,
  bufferCVFromString,
} from '@blockstack/stacks-transactions';
import {
  createNonFungiblePostCondition,
  createFungiblePostCondition,
  createSTXPostCondition,
} from '@blockstack/stacks-transactions/lib/postcondition';
import * as BN from 'bn.js';
import { readTransaction } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { getTxFromDataStore } from '../api/controllers/db-controller';
import { MemoryDataStore } from '../datastore/memory-store';
import { createDbTxFromCoreMsg } from '../datastore/common';

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
      functionArgs: [],
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
    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }
    const expectedResp = JSON.parse(
      '{"block_hash":"ff","block_height":123,"burn_block_time":345,"canonical":true,"tx_id":"bd5f225be4f1afb9a57f83cdc4c41cac761a8de0a87bc830323b049c6f3c5797","tx_index":2,"tx_status":"success","tx_type":"contract_call","fee_rate":"200","sender_address":"ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y","sponsored":false,"post_condition_mode":"deny","post_conditions":[{"type":"non_fungible","condition_code":"not_sent","principal":{"type_id":"principal_standard","address":"ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR"},"asset_value":{"hex":"0x020000000b61737365742d76616c7565","repr":"\\"asset-value\\""},"asset":{"contract_name":"hello","asset_name":"asset-name","contract_address":"STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP"}},{"type":"fungible","condition_code":"sent_greater_than","amount":"123456","principal":{"type_id":"principal_standard","address":"ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR"},"asset":{"contract_name":"hello-ft","asset_name":"asset-name-ft","contract_address":"STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP"}},{"type":"stx","condition_code":"sent_less_than","amount":"36723458","principal":{"type_id":"principal_standard","address":"ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR"}}],"contract_call":{"contract_id":"ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world","function_name":"fn-name"},"events":[]}'
    );
    expect(txQuery.result).toEqual(expectedResp);
  });
});
