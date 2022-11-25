import { StacksNetwork } from '@stacks/network';
import { AnchorMode, makeContractCall, uintCV } from '@stacks/transactions';
import { AddressStxBalanceResponse } from 'docs/generated';
import { RPCClient } from 'rpc-bitcoin';
import { ApiServer } from '../api/init';
import { testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgWriteStore } from '../datastore/pg-write-store';
import {
  Account,
  accountFromKey,
  fetchGet,
  standByForAccountUnlock,
  standByForNextPoxCycle,
  standByForTxSuccess,
  TestEnvContext,
} from '../test-utils/test-helpers';

describe('PoX-2 - Auto unlock', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;
  let bitcoinRpcClient: RPCClient;

  const seedKey = testnetKeys[3].secretKey;
  let seedAccount: Account;
  let contractAddress: string;
  let contractName: string;
  let unlockBurnHeight: number;

  beforeAll(() => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);

    seedAccount = accountFromKey(seedKey);
  });

  test('Get pox-info', async () => {
    const poxInfo = await standByForNextPoxCycle();
    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-2');
  });

  let ustxAmount: bigint;
  test('Perform stack-stx with less than min required stacking amount', async () => {
    // use half the required min amount of stx
    const poxInfo = await client.getPox();
    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 0.5).toString());
    const burnBlockHeight = poxInfo.current_burnchain_block_height as number;
    const cycleCount = 5;
    // Create and broadcast a `stack-stx` tx
    const tx1 = await makeContractCall({
      senderKey: seedAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-stx',
      functionArgs: [
        uintCV(ustxAmount.toString()),
        seedAccount.poxAddrClar,
        uintCV(burnBlockHeight),
        uintCV(cycleCount),
      ],
      network: stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000,
      validateWithAbi: false,
    });
    const sendResult1 = await client.sendTransaction(Buffer.from(tx1.serialize()));
    const txStandby1 = await standByForTxSuccess(sendResult1.txId);

    // validate stacks-node balance state
    const coreBalance = await client.getAccount(seedAccount.stxAddr);
    expect(BigInt(coreBalance.locked)).toBe(ustxAmount);
    unlockBurnHeight = coreBalance.unlock_height;

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${sendResult1.txId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-stx',
        pox_addr: seedAccount.btcTestnetAddr,
        stacker: seedAccount.stxAddr,
        balance: BigInt(coreBalance.balance).toString(),
        locked: ustxAmount.toString(),
        burnchain_unlock_height: coreBalance.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        lock_period: '5',
        lock_amount: ustxAmount.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${seedAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(ustxAmount);
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalance.unlock_height);
  });

  test('Wait for account to unlock', async () => {
    const firstAccountInfo = await client.getAccount(seedAccount.stxAddr);
    const firstPoxInfo = await client.getPox();
    const firstInfo = await client.getInfo();
    await standByForAccountUnlock(seedAccount.stxAddr);
    const lastPoxInfo = await client.getPox();
    const lastInfo = await client.getInfo();
    const lastAccountInfo = await client.getAccount(seedAccount.stxAddr);
    console.log({
      firstPoxInfo,
      lastPoxInfo,
      firstInfo,
      lastInfo,
      firstAccountInfo,
      lastAccountInfo,
    });
    expect(lastPoxInfo.current_burnchain_block_height).toBeLessThan(firstAccountInfo.unlock_height);
  });

  test('Validate pox2 handle-unlock for stacker', async () => {
    const coreBalance = await client.getAccount(seedAccount.stxAddr);
    expect(BigInt(coreBalance.balance)).toBeGreaterThan(0n);
    expect(BigInt(coreBalance.locked)).toBe(0n);
    expect(coreBalance.unlock_height).toBe(0);
    const res: any = await fetchGet(`/extended/v1/pox2_events/stacker/${seedAccount.stxAddr}`);
    const unlockEvent = res.results.find((r: any) => r.name === 'handle-unlock');
    expect(unlockEvent).toBeDefined();
    expect(unlockEvent).toEqual(
      expect.objectContaining({
        name: 'handle-unlock',
        stacker: seedAccount.stxAddr,
        balance: BigInt(coreBalance.balance).toString(),
        locked: ustxAmount.toString(),
      })
    );

    // the unlock height should now be less than the initial height reported after `stack-stx` operation
    expect(Number(unlockEvent.burnchain_unlock_height)).toBeLessThan(unlockBurnHeight);

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${seedAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(coreBalance.locked));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalance.unlock_height);
  });

  test('Perform stack-stx in time for next cycle', async () => {
    // use half the required min amount of stx
    const poxInfo = await client.getPox();
    const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    const burnBlockHeight = poxInfo.current_burnchain_block_height as number;
    const cycleCount = 1;
    // Create and broadcast a `stack-stx` tx
    const tx1 = await makeContractCall({
      senderKey: seedAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-stx',
      functionArgs: [
        uintCV(ustxAmount.toString()),
        seedAccount.poxAddrClar,
        uintCV(burnBlockHeight),
        uintCV(cycleCount),
      ],
      network: stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000,
      validateWithAbi: false,
    });
    const sendResult1 = await client.sendTransaction(Buffer.from(tx1.serialize()));
    const txStandby1 = await standByForTxSuccess(sendResult1.txId);

    // validate stacks-node balance state
    const coreBalance = await client.getAccount(seedAccount.stxAddr);
    expect(BigInt(coreBalance.locked)).toBe(ustxAmount);
    unlockBurnHeight = coreBalance.unlock_height;

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${seedAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(coreBalance.locked));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalance.unlock_height);
  });
});
