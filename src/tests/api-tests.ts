import * as supertest from 'supertest';
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
import { startApiServer, ApiServer } from '../api/init';

function getBlockchainDataTestVectors() {
  const vectors = [
    {
      getData: () => {
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

        const txBuilder = makeContractCall(
          'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
          'hello-world',
          'fn-name',
          [],
          new BN(200),
          'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
          {
            postConditions: [pc1, pc2, pc3],
          }
        );
        const serialized = txBuilder.serialize();
        const tx = readTransaction(new BufferReader(serialized));
        const dbTx = createDbTxFromCoreMsg({
          core_tx: {
            raw_tx: '0x' + serialized.toString('hex'),
            result: void 0,
            success: true,
            txid: '0x' + txBuilder.txid(),
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
        return {
          tx,
          dbTx,
          serialized,
          pc1,
          pc2,
          pc3,
          expectedResult: {
            block_hash: 'ff',
            block_height: 123,
            burn_block_time: 345,
            canonical: true,
            tx_id: '0xbd5f225be4f1afb9a57f83cdc4c41cac761a8de0a87bc830323b049c6f3c5797',
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
                asset_value: '0x020000000b61737365742d76616c7565',
                asset: {
                  contract_name: 'hello',
                  asset_name: 'asset-name',
                  contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
                },
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
            },
            events: [],
          },
        };
      },
    },
  ];
  return vectors.map(vector => [vector]);
}

const testVectors = getBlockchainDataTestVectors();

describe('public api tests', () => {
  let db: MemoryDataStore;
  let api: ApiServer;

  beforeAll(async () => {
    db = new MemoryDataStore();
    api = await startApiServer(db);
  });

  test.each(testVectors)('tx store and fetch', async input => {
    const testVector = input.getData();
    await db.updateTx(testVector.dbTx);
    const txQuery = await getTxFromDataStore(testVector.dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }
    expect(txQuery.result).toEqual(testVector.expectedResult);

    const fetchTx = await supertest(api.server).get(`/sidecar/v1/tx/${testVector.dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(testVector.expectedResult);
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => {
      api.server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  });
});
