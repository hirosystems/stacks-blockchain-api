import { BurnchainRewardSlotHolderListResponse } from '../../docs';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbTxStatus } from '../datastore/common';
import { getBitcoinAddressFromKey } from '../ec-helpers';
import {
  Account,
  fetchGet,
  stackStxWithRosetta,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';

// REUSABLE TESTS ==============================================================
// For tests that are parameterized via files, ENV, or a CI matrix - rather than
// a Jest .each test.

/**
 * Run tests shifted to different points in a cycle.
 * `offset` refers to the offset/shift from the start of a cycle.
 * i.e. 0th, 1st, 2nd, etc. block of a cycle
 */
export function testRosettaStackWithOffset({
  account,
  offset,
}: {
  account: Account;
  offset: number;
}) {
  test('Standby for cycle block mod', async () => {
    const poxInfo = await testEnv.client.getPox();
    const startHeight = poxInfo.next_cycle.reward_phase_start_block_height + offset;

    await standByUntilBurnBlock(startHeight);
  });

  test('Rosetta - stack-stx tx', async () => {
    const poxInfo = await testEnv.client.getPox();
    const ustxAmount = BigInt(poxInfo.current_cycle.min_threshold_ustx * 1.2);

    expect((poxInfo.current_burnchain_block_height as number) % poxInfo.reward_cycle_length).toBe(
      offset
    );

    await stackStxWithRosetta({
      stacksAddress: account.stxAddr,
      privateKey: account.secretKey,
      pubKey: account.pubKey,
      cycleCount: 1,
      ustxAmount,
      btcAddr: account.btcAddr,
    });
  });

  test('Verify stacked', async () => {
    // Ensure node has had time to process
    const poxInfo = await testEnv.client.getPox();
    await standByUntilBurnBlock((poxInfo.current_burnchain_block_height as number) + 1);

    const coreBalance = await testEnv.client.getAccount(account.stxAddr);
    expect(coreBalance.unlock_height).toBeGreaterThan(0);
  });
}

/**
 * Run Stacking and Reward checking tests via Rosetta for valid BTC address formats
 */
export function testRosettaStackWithBtcAddress({
  account,
  addressFormat,
}: {
  account: Account;
  addressFormat: 'p2pkh' | 'p2sh' | 'p2sh-p2wpkh' | 'p2sh-p2wsh' | 'p2wpkh' | 'p2wsh' | 'p2tr';
}) {
  const bitcoinAddress = getBitcoinAddressFromKey({
    privateKey: account.secretKey,
    network: 'testnet',
    addressFormat,
  });

  test('Ensure we are not in the last block of a cycle', async () => {
    const poxInfo = await testEnv.client.getPox();

    if (poxInfo.next_cycle.blocks_until_reward_phase === 1) {
      await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height);
    }
  });

  test('Perform stack-stx using Rosetta', async () => {
    const poxInfo = await testEnv.client.getPox();
    const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    const cycleCount = 1;

    const rosettaStackStx = await stackStxWithRosetta({
      btcAddr: bitcoinAddress,
      stacksAddress: account.stxAddr,
      pubKey: account.pubKey,
      privateKey: account.secretKey,
      cycleCount,
      ustxAmount,
    });
    expect(rosettaStackStx.tx.status).toBe(DbTxStatus.Success);
    expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox-2');
  });

  test('Validate reward set received', async () => {
    // Checks which rewards have been paid out; Pay-out to our registered
    // address happens for the 1st block of the reward cycle.
    // Due to timing issues, this test waits for an extra block until it
    // queries the reward set pay-outs. But, it still verifies the correct
    // pay-out block height.

    let poxInfo = await testEnv.client.getPox();
    const thirdBlockOfNextRewardCycle = poxInfo.next_cycle.reward_phase_start_block_height + 2;

    await standByUntilBurnBlock(thirdBlockOfNextRewardCycle);

    poxInfo = await testEnv.client.getPox();

    // Verify we're at least on the 3rd block of the cycle
    expect(poxInfo.current_burnchain_block_height).toBeGreaterThanOrEqual(
      thirdBlockOfNextRewardCycle
    );

    const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
      `/extended/v1/burnchain/reward_slot_holders/${bitcoinAddress}`
    );
    expect(rewardSlotHolders.total).toBe(1);
    expect(rewardSlotHolders.results[0].address).toBe(bitcoinAddress);
    expect(rewardSlotHolders.results[0].burn_block_height).toBe(
      thirdBlockOfNextRewardCycle - 1 // expecting the event to come in on second burn block of cycle
    );
  });
}
