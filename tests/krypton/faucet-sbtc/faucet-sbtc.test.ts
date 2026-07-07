import supertest from 'supertest';
import { ClarityVersion, makeContractDeploy } from '@stacks/transactions';
import { ENV } from '../../../src/env.ts';
import { RunFaucetResponse } from '../../../src/api/schemas/v1/responses/responses.ts';
import { AddressBalance } from '../../../src/api/schemas/v1/entities/addresses.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/v1/faucets.ts';
import {
  Account,
  accountFromKey,
  standByForTxSuccess,
  fetchGet,
  KryptonContext,
  getKryptonContext,
  stopKryptonContext,
} from '../krypton-env.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

const SBTC_CONTRACT_NAME = 'sbtc-token';
const SBTC_ASSET_NAME = 'sbtc-token';
const SBTC_CONTRACT_SOURCE = `
(define-fungible-token ${SBTC_ASSET_NAME})
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) (err u4))
    (ft-transfer? ${SBTC_ASSET_NAME} amount sender recipient)))
(ft-mint? ${SBTC_ASSET_NAME} u1000000000 tx-sender)
`;

describe('sBTC Faucet', () => {
  const reqAccountKey = 'b1ee37d996b1cf95ff67996a38426cff398d3adfeccf8ae8b3651a530837dd5801';
  let reqAccount: Account;
  let faucetAccount: Account;
  let assetIdentifier: string;
  let reqTx: RunFaucetResponse;
  let ctx: KryptonContext;

  before(async () => {
    ctx = await getKryptonContext();
    reqAccount = accountFromKey(reqAccountKey);
    // The sBTC faucet sends from the first `FAUCET_PRIVATE_KEY` key, which defaults to the first
    // testnet seeded key. Deploy the token contract from that same account so it owns the minted
    // supply.
    faucetAccount = accountFromKey(FAUCET_TESTNET_KEYS[0].secretKey);
    assetIdentifier = `${faucetAccount.stxAddr}.${SBTC_CONTRACT_NAME}::${SBTC_ASSET_NAME}`;

    const nonces = await ctx.db.getAddressNonces({ stxAddress: faucetAccount.stxAddr });
    const deployTx = await makeContractDeploy({
      contractName: SBTC_CONTRACT_NAME,
      codeBody: SBTC_CONTRACT_SOURCE,
      senderKey: faucetAccount.secretKey,
      network: ctx.stacksNetwork,
      nonce: BigInt(nonces.possibleNextNonce),
      fee: 10000n,
      clarityVersion: ClarityVersion.Clarity2,
    });
    const deployResult = await ctx.client.sendTransaction(Buffer.from(deployTx.serialize(), 'hex'));
    await standByForTxSuccess(deployResult.txId, ctx);

    ENV.TESTNET_SBTC_FAUCET_ENABLED = true;
    ENV.TESTNET_SBTC_FAUCET_ASSET_IDENTIFIER = assetIdentifier;
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('sBTC faucet address required', async () => {
    const response = await supertest(ctx.api.server).post(`/extended/v1/faucets/sbtc`);
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error, 'address required');
  });

  test('sBTC faucet http request succeeds', async () => {
    const response = await supertest(ctx.api.server).post(
      `/extended/v1/faucets/sbtc?address=${reqAccount.stxAddr}`
    );
    assert.equal(response.status, 200);
    reqTx = response.body;
    assert.equal(reqTx.success, true);
  });

  test('sBTC faucet tx mined successfully', async () => {
    const tx = await standByForTxSuccess(reqTx.txId, ctx);
    assert.equal(tx.sender_address, faucetAccount.stxAddr);
    assert.equal(tx.contract_call_contract_id, `${faucetAccount.stxAddr}.${SBTC_CONTRACT_NAME}`);
    assert.equal(tx.contract_call_function_name, 'transfer');
  });

  test('sBTC faucet recipient balance', async () => {
    const addrBalance = await fetchGet<AddressBalance>(
      `/extended/v1/address/${reqAccount.stxAddr}/balances`,
      ctx
    );
    const ftBalance = addrBalance.fungible_tokens[assetIdentifier];
    assert.ok(ftBalance);
    assert.equal(BigInt(ftBalance.balance), BigInt(ENV.TESTNET_SBTC_FAUCET_AMOUNT));
  });

  test('sBTC faucet disabled', async () => {
    ENV.TESTNET_SBTC_FAUCET_ENABLED = false;
    const response = await supertest(ctx.api.server).post(
      `/extended/v1/faucets/sbtc?address=${reqAccount.stxAddr}`
    );
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'sBTC faucet is not enabled');
    ENV.TESTNET_SBTC_FAUCET_ENABLED = true;
  });
});
