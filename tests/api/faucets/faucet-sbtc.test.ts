import supertest from 'supertest';
import { decodeTransaction, TxPayloadTypeID, PostConditionAssetInfoID } from '@stacks/codec';
import type { DecodedTxResult, TxPayloadContractCall } from '@stacks/codec';
import { STACKS_TESTNET } from '@stacks/network';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/v1/faucets.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbFaucetRequestCurrency } from '../../../src/datastore/common.ts';
import { ENV } from '../../../src/env.ts';
import { migrate } from '../../test-helpers.ts';
import { MockStacksNode, startMockStacksNode, MOCK_FEE_ESTIMATE } from './helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const RECIPIENT_ADDRESS = 'ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ';

function decodeContractCall(txRaw: string): DecodedTxResult & { payload: TxPayloadContractCall } {
  const tx = decodeTransaction(txRaw);
  assert.equal(tx.payload.type_id, TxPayloadTypeID.ContractCall);
  return tx as DecodedTxResult & { payload: TxPayloadContractCall };
}

describe('sBTC faucet', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let node: MockStacksNode;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    node = await startMockStacksNode();
    ENV.STACKS_FAUCET_NODE_HOST = '127.0.0.1';
    ENV.STACKS_FAUCET_NODE_PORT = node.port;
    ENV.TESTNET_SBTC_FAUCET_ENABLED = true;
    api = await startApiServer({
      datastore: db,
      writeDatastore: db,
      chainId: STACKS_TESTNET.chainId,
    });
  });

  afterEach(async () => {
    ENV.TESTNET_SBTC_FAUCET_ENABLED = false;
    ENV.STACKS_FAUCET_NODE_HOST = undefined;
    ENV.STACKS_FAUCET_NODE_PORT = undefined;
    await api.terminate();
    await node.close();
    await db?.close();
    await migrate('down');
  });

  test('transfers sBTC via a SIP-010 contract call', async () => {
    const [contractId, assetName] = ENV.TESTNET_SBTC_FAUCET_ASSET_IDENTIFIER.split('::');
    const [contractAddress, contractName] = contractId.split('.');
    const senderAddress = FAUCET_TESTNET_KEYS[0].stacksAddress;

    const response = await supertest(api.server).post(
      `/extended/v1/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);

    assert.equal(node.receivedTxs.length, 1);
    assert.equal(node.receivedTxs[0], response.body.txRaw);

    const tx = decodeContractCall(response.body.txRaw);
    assert.equal(response.body.txId, tx.tx_id);
    assert.equal(tx.payload.address, contractAddress);
    assert.equal(tx.payload.contract_name, contractName);
    assert.equal(tx.payload.function_name, 'transfer');
    assert.equal(tx.payload.function_args.length, 4);
    assert.equal(tx.payload.function_args[0].repr, `u${ENV.TESTNET_SBTC_FAUCET_AMOUNT}`);
    assert.equal(tx.payload.function_args[1].repr, `'${senderAddress}`);
    assert.equal(tx.payload.function_args[2].repr, `'${RECIPIENT_ADDRESS}`);
    assert.equal(tx.payload.function_args[3].repr, 'none');
    assert.equal(tx.auth.origin_condition.signer.address, senderAddress);
    assert.equal(tx.auth.origin_condition.tx_fee, MOCK_FEE_ESTIMATE.toString());

    // The transfer is guarded by an exact-amount FT post condition.
    assert.equal(tx.post_conditions.length, 1);
    const postCondition = tx.post_conditions[0];
    assert.equal(postCondition.asset_info_id, PostConditionAssetInfoID.FungibleAsset);
    if (postCondition.asset_info_id === PostConditionAssetInfoID.FungibleAsset) {
      assert.equal(postCondition.amount, ENV.TESTNET_SBTC_FAUCET_AMOUNT.toString());
      assert.equal(postCondition.asset.asset_name, assetName);
    }

    const requests = await db.getSBTCFaucetRequests(RECIPIENT_ADDRESS);
    assert.equal(requests.results.length, 1);
    assert.equal(requests.results[0].currency, DbFaucetRequestCurrency.SBTC);
  });

  test('sends the configured sBTC amount', async () => {
    const defaultAmount = ENV.TESTNET_SBTC_FAUCET_AMOUNT;
    ENV.TESTNET_SBTC_FAUCET_AMOUNT = 12345;
    try {
      const response = await supertest(api.server).post(
        `/extended/v1/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
      );
      assert.equal(response.status, 200);
      const tx = decodeContractCall(response.body.txRaw);
      assert.equal(tx.payload.function_args[0].repr, 'u12345');
    } finally {
      ENV.TESTNET_SBTC_FAUCET_AMOUNT = defaultAmount;
    }
  });

  test('falls back to a fixed fee when fee estimation is unavailable', async () => {
    node.feeEstimateResponse = { status: 500, body: { error: 'estimator offline' } };
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 200);
    const tx = decodeContractCall(response.body.txRaw);
    assert.equal(tx.auth.origin_condition.tx_fee, '1000');
  });

  test('address is required', async () => {
    const response = await supertest(api.server).post(`/extended/v1/faucets/sbtc`);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'address required', success: false });
  });

  test('requests are rate limited per address', async () => {
    for (let i = 0; i < 5; i++) {
      await db.insertFaucetRequest({
        ip: '127.0.0.1',
        address: RECIPIENT_ADDRESS,
        currency: DbFaucetRequestCurrency.SBTC,
        occurred_at: Date.now(),
      });
    }
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 429);
    assert.deepEqual(response.body, { error: 'Too many requests', success: false });
    assert.equal(node.receivedTxs.length, 0);
  });

  test('responds 503 out-of-funds when the node rejects with NotEnoughFunds', async () => {
    node.sendTxResponses.push({
      status: 400,
      body: { error: 'transaction rejected', reason: 'NotEnoughFunds' },
    });
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'The faucet is temporarily out of funds, please try again later',
      success: false,
    });
  });

  test('responds 403 when the sBTC faucet is disabled', async () => {
    ENV.TESTNET_SBTC_FAUCET_ENABLED = false;
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'sBTC faucet is not available', success: false });
  });
});
