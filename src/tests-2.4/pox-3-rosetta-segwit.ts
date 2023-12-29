/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
} from '@stacks/stacks-blockchain-api-types';
import {
  AnchorMode,
  getAddressFromPrivateKey,
  makeSTXTokenTransfer,
  TransactionVersion,
} from '@stacks/transactions';
import bignumber from 'bignumber.js';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { ECPair, getBitcoinAddressFromKey } from '../ec-helpers';
import { hexToBuffer } from '../helpers';
import {
  fetchGet,
  getRosettaAccountBalance,
  getRosettaBlockByBurnBlockHeight,
  stackStxWithRosetta,
  standByForAccountUnlock,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';

describe('PoX-3 - Rosetta - Stacking with segwit', () => {
  let btcAddr: string;
  let btcAddrTestnet: string;
  const seedAccount = testnetKeys[0];
  const accountKey = 'f4c5f7b724799370bea997b36ec922f1817e40637cb91d03ea14c8172b4ad9af01';
  let account: {
    stxAddr: string;
    secretKey: string;
    pubKey: string;
  };
  let testAccountBalance: bigint;
  let lastPoxInfo: CoreRpcPoxInfo;
  let ustxAmount: bigint;

  beforeAll(() => {
    const ecPair = ECPair.fromPrivateKey(Buffer.from(accountKey, 'hex').slice(0, 32), {
      compressed: true,
    });
    account = {
      stxAddr: getAddressFromPrivateKey(accountKey, TransactionVersion.Testnet),
      secretKey: accountKey,
      pubKey: ecPair.publicKey.toString('hex'),
    };

    btcAddr = getBitcoinAddressFromKey({
      privateKey: account.secretKey,
      network: 'regtest',
      addressFormat: 'p2wpkh',
    });
    btcAddrTestnet = getBitcoinAddressFromKey({
      privateKey: account.secretKey,
      network: 'testnet',
      addressFormat: 'p2wpkh',
    });
  });

  test('Fund new account for testing', async () => {
    await testEnv.bitcoinRpcClient.importaddress({
      address: btcAddr,
      label: btcAddr,
      rescan: false,
    });

    // transfer pox "min_amount_ustx" from seed to test account
    const poxInfo = await testEnv.client.getPox();
    testAccountBalance = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 2.1).toString());
    const stxXfer1 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: account.stxAddr,
      amount: testAccountBalance,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 200,
    });
    const { txId: stxXferId1 } = await testEnv.client.sendTransaction(
      Buffer.from(stxXfer1.serialize())
    );

    const stxXferTx1 = await standByForTxSuccess(stxXferId1);
    expect(stxXferTx1.token_transfer_recipient_address).toBe(account.stxAddr);
    await standByUntilBlock(stxXferTx1.block_height);
  });

  test('Validate test account balance', async () => {
    // test stacks-node account RPC balance
    const coreNodeBalance = await testEnv.client.getAccount(account.stxAddr);
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

  test('Rosetta - stack-stx', async () => {
    // todo: without the `standByForPoxCycle` this test fails currenty with a
    //       (err 24) ERR_INVALID_START_BURN_HEIGHT, which should not be
    //       possible with rosetta, but might happen in race conditions
    // This should be investigated further, but is not the purpose of this test
    await standByForPoxCycle();

    const cycleCount = 1;

    const poxInfo = await testEnv.client.getPox();
    lastPoxInfo = poxInfo;
    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

    const stackingResult = await stackStxWithRosetta({
      btcAddr: btcAddr,
      stacksAddress: account.stxAddr,
      pubKey: account.pubKey,
      privateKey: account.secretKey,
      cycleCount: cycleCount,
      ustxAmount: ustxAmount,
    });

    expect(stackingResult.constructionMetadata.metadata.contract_name).toBe('pox-3');
    expect(stackingResult.constructionMetadata.metadata.burn_block_height as number).toBeTruthy();
    expect(stackingResult.submitResult.transaction_identifier.hash).toBe(stackingResult.txId);
    expect(stackingResult.tx.contract_call_contract_id).toBe('ST000000000000000000002AMW42H.pox-3');
  });

  test('Verify expected amount of STX are locked', async () => {
    // test stacks-node account RPC balance
    const coreNodeBalance = await testEnv.client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.balance)).toBeLessThan(testAccountBalance);
    expect(BigInt(coreNodeBalance.locked)).toBe(ustxAmount);

    // test API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.balance)).toBeLessThan(testAccountBalance);
    expect(BigInt(apiBalance.locked)).toBe(ustxAmount);

    // test Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.account.balances[0].value)).toBeLessThan(testAccountBalance);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(ustxAmount);
  });

  test('Verify PoX rewards - Bitcoin RPC', async () => {
    // Wait until end of reward phase
    const rewardPhaseEndBurnBlock =
      lastPoxInfo.next_cycle.reward_phase_start_block_height +
      lastPoxInfo.reward_phase_block_length +
      1;
    await standByUntilBurnBlock(rewardPhaseEndBurnBlock);

    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddrTestnet}`
    );
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];

    let received: {
      address: string;
      category: string;
      amount: number;
      blockhash: string;
      blockheight: number;
      txid: string;
      confirmations: number;
    }[] = await testEnv.bitcoinRpcClient.listtransactions({
      label: btcAddr,
      include_watchonly: true,
    });
    received = received.filter(r => r.address === btcAddr);
    expect(received.length).toBe(1);
    expect(received[0].category).toBe('receive');
    expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
    const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
    expect(sats).toBe(firstReward.reward_amount);
  });

  test('Rosetta unlock events', async () => {
    // unlock_height: 115
    const rpcAccountInfo1 = await testEnv.client.getAccount(account.stxAddr);
    const rpcAccountLocked = BigInt(rpcAccountInfo1.locked).toString();
    const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;

    // Wait until account has unlocked (finished Stacking cycles)
    // (wait one more block due to test flakiness..)
    await standByUntilBurnBlock(burnBlockUnlockHeight + 1);

    // verify STX unlocked - stacks-node account RPC balance
    const coreNodeBalance = await testEnv.client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.locked)).toBe(0n);
    expect(coreNodeBalance.unlock_height).toBe(0);

    // verify STX unlocked - API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(0n);

    // verify STX unlocked - Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);

    // Get Stacks block associated with the burn block `unlock_height` reported by RPC
    const unlockRstaBlock = await getRosettaBlockByBurnBlockHeight(rpcAccountInfo1.unlock_height);

    // Ensure Rosetta block contains a stx_unlock operation
    const unlockOp = unlockRstaBlock
      .block!.transactions.flatMap(t => t.operations)
      .find(op => op.type === 'stx_unlock')!;
    expect(unlockOp).toBeDefined();
    expect(unlockOp).toEqual(
      expect.objectContaining({
        type: 'stx_unlock',
        status: 'success',
        account: { address: account.stxAddr },
        amount: { value: rpcAccountLocked, currency: { symbol: 'STX', decimals: 6 } },
      })
    );
  });

  test('Stack below threshold to trigger early auto-unlock', async () => {
    const cycleCount = 5;

    const poxInfo = await testEnv.client.getPox();
    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 0.5).toString());

    const rosettaStackStx = await stackStxWithRosetta({
      btcAddr: btcAddr,
      stacksAddress: account.stxAddr,
      pubKey: account.pubKey,
      privateKey: account.secretKey,
      cycleCount,
      ustxAmount,
    });

    expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox-3');
    expect(rosettaStackStx.constructionMetadata.metadata.burn_block_height as number).toBeTruthy();
    expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
    expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
      'ST000000000000000000002AMW42H.pox-3'
    );

    // ensure locked reported by stacks-node account RPC balance
    const coreNodeBalance = await testEnv.client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.locked)).toBe(ustxAmount);
    expect(coreNodeBalance.unlock_height).toBeGreaterThan(0);

    // ensure locked reported by API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(ustxAmount);

    // ensure locked reported by Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(ustxAmount);
  });

  let earlyUnlockBurnHeight: number;
  test('Ensure account unlocks early', async () => {
    const initialAccountInfo = await testEnv.client.getAccount(account.stxAddr);
    await standByForAccountUnlock(account.stxAddr);

    const poxInfo = await testEnv.client.getPox();
    earlyUnlockBurnHeight = poxInfo.current_burnchain_block_height!;

    // ensure account unlocked early, before the typically expected unlock height
    expect(earlyUnlockBurnHeight).toBeLessThan(initialAccountInfo.unlock_height);

    // ensure zero locked reported by stacks-node account RPC balance
    const coreNodeBalance = await testEnv.client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.locked)).toBe(0n);

    // ensure zero locked reported by API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(0n);

    // ensure zero locked reported by Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);
  });

  test('Ensure unlock operation generated after auto-unlock', async () => {
    await standByUntilBurnBlock(earlyUnlockBurnHeight + 2);

    // Get Stacks block associated with the burn block `unlock_height` reported by RPC
    const unlockRstaBlock = await getRosettaBlockByBurnBlockHeight(earlyUnlockBurnHeight);

    // Ensure Rosetta block contains a stx_unlock operation
    const unlockOps = unlockRstaBlock
      .block!.transactions.flatMap(t => t.operations)
      .filter(op => op.type === 'stx_unlock')!;
    expect(unlockOps).toHaveLength(1);
    expect(unlockOps[0]).toEqual(
      expect.objectContaining({
        type: 'stx_unlock',
        status: 'success',
        account: { address: account.stxAddr },
        amount: { value: ustxAmount.toString(), currency: { symbol: 'STX', decimals: 6 } },
      })
    );

    // Ensure balance is unlocked
    const unlockStackBlock = await testEnv.db.getBlockByBurnBlockHeight(earlyUnlockBurnHeight);
    const balance = await getRosettaAccountBalance(
      account.stxAddr,
      unlockStackBlock.result!.block_height
    );
    expect(BigInt(balance.locked.balances[0].value)).toBe(0n);

    // Ensure balance from previous block is still reported as locked
    const prevStackBlock = await testEnv.db.getBlockByBurnBlockHeight(earlyUnlockBurnHeight - 1);
    const balancePrevBlock = await getRosettaAccountBalance(
      account.stxAddr,
      prevStackBlock.result!.block_height
    );
    expect(BigInt(balancePrevBlock.locked.balances[0].value)).toBe(ustxAmount);

    // Ensure balance in next block is reported as unlocked
    const nextStackBlock = await testEnv.db.getBlockByBurnBlockHeight(earlyUnlockBurnHeight + 1);
    const balanceNextBlock = await getRosettaAccountBalance(
      account.stxAddr,
      nextStackBlock.result!.block_height
    );
    expect(BigInt(balanceNextBlock.locked.balances[0].value)).toBe(0n);

    // Ensure stx_unlock operations and balances are correct for before and after blocks
    const surroundingBlocks = [earlyUnlockBurnHeight - 1, earlyUnlockBurnHeight + 1];
    for (const surroundingBlock of surroundingBlocks) {
      const block2 = await getRosettaBlockByBurnBlockHeight(surroundingBlock);
      const unlockOps2 = block2
        .block!.transactions.flatMap(t => t.operations)
        .filter(op => op.type === 'stx_unlock')!;
      expect(unlockOps2).toHaveLength(0);
    }
  });
});
