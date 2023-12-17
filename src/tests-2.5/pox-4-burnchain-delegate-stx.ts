/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  AddressStxBalanceResponse,
  ContractCallTransaction,
  TransactionEventsResponse,
  TransactionEventStxLock,
} from '@stacks/stacks-blockchain-api-types';
import {
  AnchorMode,
  makeContractCall,
  makeSTXTokenTransfer,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { ECPair } from '../ec-helpers';
import { BootContractAddress } from '../helpers';
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
import { PoxContractIdentifier } from '../pox-helpers';
import { ClarityValueUInt, decodeClarityValue } from 'stacks-encoding-native-js';
import { decodeBtcAddress } from '@stacks/stacking';
import { timeout } from '@hirosystems/api-toolkit';

// Perform Delegate-STX operation on Bitcoin.
// See https://github.com/stacksgov/sips/blob/a7f2e58ec90c12ee1296145562eec75029b89c48/sips/sip-015/sip-015-network-upgrade.md#new-burnchain-transaction-delegate-stx
async function createPox2DelegateStx(args: {
  stxAmount: bigint;
  cycleCount: number;
  stackerAddress: string;
  delegatorStacksAddress: string;
  untilBurnHt: number;
  poxAddrPayout: string;
  bitcoinWif: string;
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

  const dust = 10005;
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

  // DelegateStxOp: this operation executes the delegate-stx operation.
  // 0      2  3                     19            24            33
  // |------|--|---------------------|-------------|-------------|
  //  magic  op  uSTX to lock (u128)  output index  until-burn-ht
  //
  // Fields descriptions:
  //  * Bytes 0-2 are the magic bytes that identify this as a Stacks transaction.
  //  * Bytes 2-3 is the opcode, which shall be # (0x23).
  //  * Bytes 3-19 is the number of uSTX to delegate, as a 128-bit big-endian integer. This corresponds to the amount-ustx argument to delegate-stx.
  //  * Bytes 19-24 is the optional index of the transaction output.
  //    * If Byte 19 is set to 0x00, then this field is ignored. This corresponds to passing none to the pox-addr argument in delegate-stx.
  //    * If Byte 19 is set to 0x01, then bytes 20-23 are interpreted as a 32-bit big-endian integer, which shall index one of the transaction
  //      outputs after the OP_RETURN output. For example, the output at index 0 is the first output after the OP_RETURN output, index 1 is the second
  //      after, etc. The output's address, if it decodes to a valid PoX address tuple, will be used as the pox-addr argument to delegate-stx.
  //  * Bytes 24-33 is the optional last burnchain block height for which these uSTX are delegated.
  //    * If Byte 24 is set to 0x00, then this field is ignored. It corresponds to passing none to the until-burn-ht argument in delegate-stx.
  //    * If Byte 24 is set to 0x01, then this field is the 128-bit big-endian integer that encodes the burnchain block height at which this
  //      delegation expires. This value corresponds to the until-burn-ht argument in delegate-stx.

  const untilBurnHt = Buffer.alloc(8);
  untilBurnHt.writeBigUInt64BE(BigInt(args.untilBurnHt));

  const delegateStxOpTxPayload = Buffer.concat([
    Buffer.from('id'), // magic: 'id' ascii encoded (for krypton)
    Buffer.from('#'), // op: '#' ascii encoded,
    Buffer.from(args.stxAmount.toString(16).padStart(32, '0'), 'hex'), // uSTX to lock (u128)
    Buffer.from('0100000001', 'hex'), // specify the `pox-addr` arg to the second output address
    Buffer.from(`01${untilBurnHt.toString('hex')}`, 'hex'), // corresponds to passing none to the until-burn-ht argument in delegate-stx (u64)
  ]);
  const delegateStxOpTxHex = new btc.Psbt({ network: btc.networks.regtest })
    .setVersion(1)
    // The first input to the Bitcoin operation must consume a UTXO that is the second output of a PreStxOp.
    // This validates that the DelegateStxOp was signed by the appropriate Stacker address.
    .addInput({ hash: preStxOpTxId, index: 1, nonWitnessUtxo: Buffer.from(preStxOpTxHex, 'hex') })
    // The first transaction output must contain an OP_RETURN payload.
    .addOutput({
      script: btc.payments.embed({ data: [delegateStxOpTxPayload] }).output!,
      value: 0,
    })
    // The second transaction output encodes the Stacks address to which the STX are delegated. This output must
    // decode to a Stacks address. This field corresponds to the delegate-to argument in delegate-stx.
    .addOutput({
      address: c32ToB58(args.delegatorStacksAddress),
      value: Math.round(outAmount1 - feeAmount * sats - dust),
    })
    // Add output for the `pox-addr`
    .addOutput({
      address: args.poxAddrPayout,
      value: dust,
    })
    .signInput(0, btcAccount)
    .finalizeAllInputs()
    .extractTransaction(false)
    .toHex();
  const delegateStxOpTxId: string = await testEnv.bitcoinRpcClient.sendrawtransaction({
    hexstring: delegateStxOpTxHex,
  });

  return {
    preStxOpTxId: preStxOpTxId,
    delegateStxOpTxId: delegateStxOpTxId,
  };
}

describe('PoX-4 - Stack using Bitcoin-chain ops', () => {
  const seedAccount = testnetKeys[0];

  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;
  let bitcoinRpcClient: RPCClient;

  // ST1Z7V02CJRY3G5R2RDG7SFAZA8VGH0Y44NC2NAJN
  const accountKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
  let account: Account;

  // mmf4gs6mwBYpudc2agd7MomJo8HJd6XksD
  // ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y
  const delegatorKey = '21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601';
  let delegatorAccount: Account;

  // testnet btc addr: tb1pf4x64urhdsdmadxxhv2wwjv6e3evy59auu2xaauu3vz3adxtskfschm453
  // regtest btc addr: bcrt1pf4x64urhdsdmadxxhv2wwjv6e3evy59auu2xaauu3vz3adxtskfs4w3npt
  const poxAddrPayoutKey = 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01';
  let poxAddrPayoutAccount: Account;

  let testAccountBalance: bigint;
  const testAccountBtcBalance = 5;
  let testStackAmount: bigint;

  const untilBurnHeight = 200;

  let stxOpBtcTxs: {
    preStxOpTxId: string;
    delegateStxOpTxId: string;
  };

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);

    account = accountFromKey(accountKey);
    delegatorAccount = accountFromKey(delegatorKey);
    poxAddrPayoutAccount = accountFromKey(poxAddrPayoutKey, 'p2tr');

    const poxInfo = await client.getPox();
    const [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-4');
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

  test('Delegate-stx via Bitcoin tx', async () => {
    const poxInfo = await client.getPox();
    testStackAmount = BigInt(poxInfo.min_amount_ustx * 1.2);
    stxOpBtcTxs = await createPox2DelegateStx({
      bitcoinWif: account.wif,
      stackerAddress: account.stxAddr,
      delegatorStacksAddress: delegatorAccount.stxAddr,
      poxAddrPayout: poxAddrPayoutAccount.btcAddr,
      untilBurnHt: untilBurnHeight,
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
      const delegateStxOpTxResult = await bitcoinRpcClient.gettransaction({
        txid: stxOpBtcTxs.delegateStxOpTxId,
        verbose: true,
      });
      if (preOpTxResult.confirmations > 1 && delegateStxOpTxResult.confirmations > 1) {
        break;
      }
      await timeout(150);
    }
  });

  test('Wait for 1 Stacks block', async () => {
    const curInfo = await client.getInfo();
    await standByUntilBlock(curInfo.stacks_tip_height + 1);
  });

  test('Ensure delegate-stx BitcoinOp parsed', async () => {
    const pox2Txs = await supertest(api.server)
      .get(`/extended/v1/address/${BootContractAddress.testnet}.pox-4/transactions`)
      .expect(200);
    const delegateStxTxResp = await supertest(api.server)
      .get(`/extended/v1/tx/${pox2Txs.body.results[0].tx_id}`)
      .expect(200);
    const delegateStxTx = delegateStxTxResp.body as ContractCallTransaction;
    expect(delegateStxTx.tx_status).toBe('success');
    expect(delegateStxTx.tx_type).toBe('contract_call');
    expect(delegateStxTx.sender_address).toBe(account.stxAddr);
    expect(delegateStxTx.tx_result).toEqual({ hex: '0x0703', repr: '(ok true)' });

    const expectedPoxPayoutAddr = decodeBtcAddress(poxAddrPayoutAccount.btcTestnetAddr);
    const expectedPoxPayoutAddrRepr = `(some (tuple (hashbytes 0x${Buffer.from(
      expectedPoxPayoutAddr.data
    ).toString('hex')}) (version 0x${Buffer.from([expectedPoxPayoutAddr.version]).toString(
      'hex'
    )})))`;

    expect(delegateStxTx.contract_call).toEqual({
      contract_id: 'ST000000000000000000002AMW42H.pox-4',
      function_name: 'delegate-stx',
      function_signature:
        '(define-public (delegate-stx (amount-ustx uint) (delegate-to principal) (until-burn-ht (optional uint)) (pox-addr (optional (tuple (hashbytes (buff 32)) (version (buff 1)))))))',
      function_args: [
        {
          hex: '0x0100000000000000000007fe8f3d591000',
          repr: 'u2250216000000000',
          name: 'amount-ustx',
          type: 'uint',
        },
        {
          hex: '0x051a43596b5386f466863e25658ddf94bd0fadab0048',
          repr: `'${delegatorAccount.stxAddr}`,
          name: 'delegate-to',
          type: 'principal',
        },
        {
          hex: '0x0a01000000000000000000000000000000c8',
          repr: `(some u${untilBurnHeight})`,
          name: 'until-burn-ht',
          type: '(optional uint)',
        },
        {
          hex: '0x0a0c000000020968617368627974657302000000204d4daaf0776c1bbeb4c6bb14e7499acc72c250bde7146ef79c8b051eb4cb85930776657273696f6e020000000106',
          repr: expectedPoxPayoutAddrRepr,
          name: 'pox-addr',
          type: '(optional (tuple (hashbytes (buff 32)) (version (buff 1))))',
        },
      ],
    });
  });

  test('Perform delegate-stack-stx', async () => {
    const poxInfo = await testEnv.client.getPox();
    const [contractAddress, contractName] = poxInfo.contract_id.split('.');
    const startBurnHt = poxInfo.current_burnchain_block_height as number;

    const txFee = 10000n;
    const delegateStackStxTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(account.stxAddr), // stacker
        uintCV(testStackAmount), // amount-ustx
        poxAddrPayoutAccount.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(1), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackStxTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    const delegateStackStxDbTx = await standByForTxSuccess(delegateStackStxTxId);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(account.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(testStackAmount);
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackStxTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-stx',
        pox_addr: poxAddrPayoutAccount.btcTestnetAddr,
        stacker: account.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: testStackAmount.toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        lock_period: '1',
        lock_amount: testStackAmount.toString(),
      })
    );
  });

  // TODO: unable to parse this synthetic `delegate-stx` tx due to missing events,
  // see https://github.com/stacks-network/stacks-blockchain/issues/3465
  test.skip('Test synthetic STX tx', async () => {
    const coreNodeBalance = await client.getAccount(account.stxAddr);
    const addressEventsResp = await supertest(api.server)
      .get(`/extended/v1/tx/events?address=${account.stxAddr}`)
      .expect(200);
    const delegatorAddressEventsResp = await supertest(api.server)
      .get(`/extended/v1/tx/events?address=${delegatorAccount.stxAddr}`)
      .expect(200);
    console.log(delegatorAddressEventsResp);
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
    expect(txObj.contract_call.contract_id).toBe(PoxContractIdentifier.pox2.testnet);
    expect(txObj.contract_call.function_name).toBe('stack-stx');

    const callArg1 = txObj.contract_call.function_args![0];
    expect(callArg1.name).toBe('amount-ustx');
    expect(BigInt(decodeClarityValue<ClarityValueUInt>(callArg1.hex).value)).toBe(testStackAmount);

    const callArg2 = txObj.contract_call.function_args![1];
    expect(callArg2.name).toBe('pox-addr');
    const callArg2Addr = decodePoxAddrArg(callArg2.hex);
    expect(callArg2Addr.stxAddr).toBe(account.stxAddr);
    expect(callArg2Addr.btcAddr).toBe(account.btcAddr);
  });
});
