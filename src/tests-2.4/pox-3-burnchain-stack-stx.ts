/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  AddressStxBalanceResponse,
  ContractCallTransaction,
  TransactionEventsResponse,
  TransactionEventStxLock,
} from '@stacks/stacks-blockchain-api-types';
import { AnchorMode, makeSTXTokenTransfer } from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { ECPair } from '../ec-helpers';
import { BootContractAddress, timeout } from '../helpers';
import {
  Account,
  accountFromKey,
  decodePoxAddrArg,
  fetchGet,
  getRosettaAccountBalance,
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
  testEnv,
  TestEnvContext,
} from '../test-utils/test-helpers';
import * as btc from 'bitcoinjs-lib';
import { b58ToC32, c32ToB58 } from 'c32check';
import { PgWriteStore } from '../datastore/pg-write-store';
import { ApiServer } from '../api/init';
import { StacksNetwork } from '@stacks/network';
import { RPCClient } from 'rpc-bitcoin';
import * as supertest from 'supertest';
import { Pox2ContractIdentifer } from '../pox-helpers';
import { ClarityValueUInt, decodeClarityValue } from 'stacks-encoding-native-js';
import { decodeBtcAddress } from '@stacks/stacking';

// Perform Stack-STX operation on Bitcoin.
// See https://github.com/stacksgov/sips/blob/0da29c6911c49c45e4125dbeaed58069854591eb/sips/sip-007/sip-007-stacking-consensus.md#stx-operations-on-bitcoin
async function createPox2StackStx(args: {
  stxAmount: bigint;
  cycleCount: number;
  stackerAddress: string;
  bitcoinWif: string;
  poxAddrPayout: string;
}) {
  const btcAccount = ECPair.fromWIF(args.bitcoinWif, btc.networks.regtest);
  const feeAmount = 0.0001;
  const sats = 100000000;

  const btcAddr = btc.payments.p2pkh({
    pubkey: btcAccount.publicKey,
    network: btc.networks.regtest,
  }).address!;
  const derivedStacksAddr = b58ToC32(btcAddr);
  expect(derivedStacksAddr).toBe(args.stackerAddress);

  const utxos: any[] = await testEnv.bitcoinRpcClient.listunspent({
    addresses: [btcAddr],
    include_unsafe: false,
  });
  const utxo = utxos[0];
  expect(utxo.spendable).toBe(true);
  expect(utxo.safe).toBe(true);
  expect(utxo.confirmations).toBeGreaterThan(0);
  const utxoRawTx = await testEnv.bitcoinRpcClient.getrawtransaction({ txid: utxo.txid });

  // PreStxOp: this operation prepares the Stacks blockchain node to validate the subsequent StackStxOp or TransferStxOp.
  // 0      2  3
  // |------|--|
  //  magic  op
  const preStxOpPayload = Buffer.concat([
    Buffer.from('id'), // magic: 'id' ascii encoded (for krypton)
    Buffer.from('p'), // op: 'p' ascii encoded
  ]);
  const outAmount1 = Math.round((utxo.amount - feeAmount) * sats);
  const preStxOpTxHex = new btc.Psbt({ network: btc.networks.regtest })
    .setVersion(1)
    .addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(utxoRawTx, 'hex'),
    })
    .addOutput({
      script: btc.payments.embed({ data: [preStxOpPayload] }).output!,
      value: 0,
    })
    // Then, the second Bitcoin output must be Stacker address that will be used in a StackStxOp.
    // This address must be a standard address type parseable by the stacks-blockchain node.
    .addOutput({
      address: c32ToB58(args.stackerAddress),
      value: outAmount1,
    })
    .signInput(0, btcAccount)
    .finalizeAllInputs()
    .extractTransaction(false)
    .toHex();
  const preStxOpTxId: string = await testEnv.bitcoinRpcClient.sendrawtransaction({
    hexstring: preStxOpTxHex,
  });

  // StackStxOp: this operation executes the stack-stx operation.
  // 0      2  3                             19        20
  // |------|--|-----------------------------|---------|
  //  magic  op         uSTX to lock (u128)     cycles (u8)
  const stackStxOpTxPayload = Buffer.concat([
    Buffer.from('id'), // magic: 'id' ascii encoded (for krypton)
    Buffer.from('x'), // op: 'x' ascii encoded,
    Buffer.from(args.stxAmount.toString(16).padStart(32, '0'), 'hex'), // uSTX to lock (u128)
    Buffer.from([args.cycleCount]), // cycles (u8)
  ]);
  const stackStxOpTxHex = new btc.Psbt({ network: btc.networks.regtest })
    .setVersion(1)
    // The first input to the Bitcoin operation must consume a UTXO that is the second output of a PreStxOp.
    // This validates that the StackStxOp was signed by the appropriate Stacker address.
    .addInput({ hash: preStxOpTxId, index: 1, nonWitnessUtxo: Buffer.from(preStxOpTxHex, 'hex') })
    .addOutput({
      script: btc.payments.embed({ data: [stackStxOpTxPayload] }).output!,
      value: 0,
    })
    // The second Bitcoin output will be used as the reward address for any stacking rewards.
    .addOutput({
      address: args.poxAddrPayout,
      value: Math.round(outAmount1 - feeAmount * sats),
    })
    .signInput(0, btcAccount)
    .finalizeAllInputs()
    .extractTransaction(false)
    .toHex();
  const stackStxOpTxId: string = await testEnv.bitcoinRpcClient.sendrawtransaction({
    hexstring: stackStxOpTxHex,
  });

  return {
    preStxOpTxId: preStxOpTxId,
    stackStxOpTxId: stackStxOpTxId,
  };
}

describe('PoX-3 - Stack using Bitcoin-chain ops', () => {
  const seedAccount = testnetKeys[0];

  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;
  let bitcoinRpcClient: RPCClient;

  const accountKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
  let account: Account;

  // testnet btc addr: tb1pf4x64urhdsdmadxxhv2wwjv6e3evy59auu2xaauu3vz3adxtskfschm453
  // regtest btc addr: bcrt1pf4x64urhdsdmadxxhv2wwjv6e3evy59auu2xaauu3vz3adxtskfs4w3npt
  const poxAddrPayoutKey = 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01';
  let poxAddrPayoutAccount: Account;

  let testAccountBalance: bigint;
  const testAccountBtcBalance = 5;
  let testStackAmount: bigint;

  let stxOpBtcTxs: {
    preStxOpTxId: string;
    stackStxOpTxId: string;
  };

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);

    account = accountFromKey(accountKey);
    poxAddrPayoutAccount = accountFromKey(poxAddrPayoutKey, 'p2tr');

    const poxInfo = await client.getPox();
    const [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-3');
  });

  test('Fund STX to new account for testing', async () => {
    await bitcoinRpcClient.importaddress({
      address: account.btcAddr,
      label: account.btcAddr,
      rescan: false,
    });
    await bitcoinRpcClient.importprivkey({
      privkey: account.wif,
      label: account.btcAddr,
      rescan: false,
    });

    // transfer pox "min_amount_ustx" from seed to test account
    const poxInfo = await client.getPox();
    testAccountBalance = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 2.1).toString());
    const stxXfer1 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: account.stxAddr,
      amount: testAccountBalance,
      network: stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 200,
    });
    const { txId: stxXferId1 } = await client.sendTransaction(Buffer.from(stxXfer1.serialize()));

    const stxXferTx1 = await standByForTxSuccess(stxXferId1);
    expect(stxXferTx1.token_transfer_recipient_address).toBe(account.stxAddr);
  });

  test('Verify expected amount of STX are funded', async () => {
    // test stacks-node account RPC balance
    const coreNodeBalance = await client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.balance)).toBe(testAccountBalance);
    expect(BigInt(coreNodeBalance.locked)).toBe(0n);

    // test API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.balance)).toBe(testAccountBalance);
    expect(BigInt(apiBalance.locked)).toBe(0n);

    // test Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.account.balances[0].value)).toBe(testAccountBalance);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);
  });

  test('Fund BTC to new account for testing', async () => {
    const fundTxId: string = await bitcoinRpcClient.sendtoaddress({
      address: account.btcAddr,
      amount: testAccountBtcBalance,
    });
    while (true) {
      const txResp = await bitcoinRpcClient.gettransaction({
        txid: fundTxId,
        verbose: true,
      });
      if (txResp.confirmations > 1) {
        break;
      }
      await timeout(150);
    }
  });

  test('Verify expected amount of BTC is funded', async () => {
    const receivedAmount = await bitcoinRpcClient.getreceivedbylabel({ label: account.btcAddr });
    expect(receivedAmount).toBe(testAccountBtcBalance);
  });

  test('Standby for next cycle', async () => {
    const poxInfo = await client.getPox();
    await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height); // a good time to stack
  });

  test('Stack via Bitcoin tx', async () => {
    const poxInfo = await client.getPox();
    testStackAmount = BigInt(poxInfo.min_amount_ustx * 1.2);
    stxOpBtcTxs = await createPox2StackStx({
      bitcoinWif: account.wif,
      stackerAddress: account.stxAddr,
      poxAddrPayout: poxAddrPayoutAccount.btcAddr,
      stxAmount: testStackAmount,
      cycleCount: 6,
    });
  });

  test('Wait for Stack Bitcoin txs to confirm', async () => {
    while (true) {
      const preOpTxResult = await bitcoinRpcClient.gettransaction({
        txid: stxOpBtcTxs.preStxOpTxId,
        verbose: true,
      });
      const stackOpTxResult = await bitcoinRpcClient.gettransaction({
        txid: stxOpBtcTxs.stackStxOpTxId,
        verbose: true,
      });
      if (preOpTxResult.confirmations > 1 && stackOpTxResult.confirmations > 1) {
        break;
      }
      await timeout(150);
    }
  });

  test('Wait for 1 Stacks block', async () => {
    const curInfo = await client.getInfo();
    await standByUntilBlock(curInfo.stacks_tip_height + 1);
  });

  test('Test synthetic STX tx', async () => {
    const coreNodeBalance = await client.getAccount(account.stxAddr);
    const addressEventsResp = await supertest(api.server)
      .get(`/extended/v1/tx/events?address=${account.stxAddr}`)
      .expect(200);
    const addressEvents = addressEventsResp.body.events as TransactionEventsResponse['results'];
    const event1 = addressEvents[0] as TransactionEventStxLock;
    expect(event1.event_type).toBe('stx_lock');
    expect(event1.stx_lock_event.locked_address).toBe(account.stxAddr);
    expect(event1.stx_lock_event.unlock_height).toBeGreaterThan(0);
    expect(BigInt(event1.stx_lock_event.locked_amount)).toBe(testStackAmount);
    expect(BigInt(event1.stx_lock_event.locked_amount)).toBe(BigInt(coreNodeBalance.locked));

    const txResp = await supertest(api.server).get(`/extended/v1/tx/${event1.tx_id}`).expect(200);
    const txObj = txResp.body as ContractCallTransaction;
    expect(txObj.tx_type).toBe('contract_call');
    expect(txObj.tx_status).toBe('success');
    expect(txObj.sender_address).toBe(account.stxAddr);
    expect(txObj.contract_call.contract_id).toBe(`${BootContractAddress.testnet}.pox-3`);
    expect(txObj.contract_call.function_name).toBe('stack-stx');

    const callArg1 = txObj.contract_call.function_args![0];
    expect(callArg1.name).toBe('amount-ustx');
    expect(BigInt(decodeClarityValue<ClarityValueUInt>(callArg1.hex).value)).toBe(testStackAmount);

    const expectedPoxPayoutAddr = decodeBtcAddress(poxAddrPayoutAccount.btcTestnetAddr);
    const expectedPoxPayoutAddrRepr = `(tuple (hashbytes 0x${Buffer.from(
      expectedPoxPayoutAddr.data
    ).toString('hex')}) (version 0x${Buffer.from([expectedPoxPayoutAddr.version]).toString(
      'hex'
    )}))`;
    const callArg2 = txObj.contract_call.function_args![1];
    expect(callArg2.name).toBe('pox-addr');
    expect(callArg2.type).toBe('(tuple (hashbytes (buff 32)) (version (buff 1)))');
    expect(callArg2.repr).toBe(expectedPoxPayoutAddrRepr);
  });

  // TODO: this is very flaky
  test.skip('Verify expected amount of STX are locked', async () => {
    // test stacks-node account RPC balance
    const coreNodeBalance = await client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.balance)).toBeLessThan(testAccountBalance);
    expect(BigInt(coreNodeBalance.locked)).toBe(testStackAmount);

    // test API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.balance)).toBeLessThan(testAccountBalance);
    expect(BigInt(apiBalance.locked)).toBe(testStackAmount);

    // test Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.account.balances[0].value)).toBeLessThan(testAccountBalance);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(testStackAmount);
  });
});
