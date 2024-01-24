import { hexToBuffer, timeout } from '@hirosystems/api-toolkit';
import { decodeBtcAddress } from '@stacks/stacking';
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import {
  AnchorMode,
  bufferCV,
  makeContractCall,
  randomBytes,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import bignumber from 'bignumber.js';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbEventTypeId, DbStxLockEvent } from '../datastore/common';
import { getBitcoinAddressFromKey, privateToPublicKey } from '../ec-helpers';
import {
  fetchGet,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';

const BTC_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000002';

describe.each([P2SH_P2WPKH, P2WPKH, P2WSH, P2TR])(
  'PoX-4 - Stack using bitcoin address %p',
  addressSetup => {
    const account = testnetKeys[1];

    let poxInfo: CoreRpcPoxInfo;
    let burnBlockHeight: number;
    let cycleBlockLength: number;
    let contractAddress: string;
    let contractName: string;
    let ustxAmount: bigint;
    const cycleCount = 1;

    const { btcAddr, btcAddrDecoded, btcAddrRegtest, btcDescriptor } = addressSetup();

    test('prepare', async () => {
      await standByForPoxCycle();

      try {
        // legacy wallets
        await testEnv.bitcoinRpcClient.importaddress({
          address: btcAddrRegtest,
          label: btcAddrRegtest,
        });
        const btcWalletAddrs = await testEnv.bitcoinRpcClient.getaddressesbylabel({
          label: btcAddrRegtest,
        });
        expect(Object.keys(btcWalletAddrs)).toContain(btcAddrRegtest);
      } catch (e) {
        // descriptor wallets, if legacy wallet import fails
        await withDescriptorWallet(async walletName => {
          const info = await testEnv.bitcoinRpcClient.getdescriptorinfo({
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            descriptor: btcDescriptor!,
          });
          const request = { label: btcAddrRegtest, desc: info.descriptor, timestamp: 'now' };
          await testEnv.bitcoinRpcClient.rpc(
            'importdescriptors',
            { requests: [request] },
            walletName
          );
        });
      }

      poxInfo = await testEnv.client.getPox();

      burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
      [contractAddress, contractName] = poxInfo.contract_id.split('.');

      expect(contractName).toBe('pox-4');
    });

    test('stack-stx tx', async () => {
      // Create and broadcast a `stack-stx` tx
      const tx = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()), // amount-ustx
          tupleCV({
            hashbytes: bufferCV(btcAddrDecoded.data),
            version: bufferCV(Buffer.from([btcAddrDecoded.version])),
          }), // pox-addr
          uintCV(burnBlockHeight), // start-burn-ht
          uintCV(cycleCount), // lock-period
          bufferCV(randomBytes(33)), // signer-key
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId = '0x' + tx.txid();
      const sendResult = await testEnv.client.sendTransaction(Buffer.from(tx.serialize()));
      expect(sendResult.txId).toBe(expectedTxId);

      // Wait for API to receive and ingest tx
      const dbTx = await standByForTxSuccess(expectedTxId);

      const txEvents = await testEnv.api.datastore.getTxEvents({
        txId: expectedTxId,
        indexBlockHash: dbTx.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(txEvents.results).toBeTruthy();
      const lockEvent = txEvents.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent).toBeDefined();
      expect(lockEvent.locked_address).toBe(account.stacksAddress);
      expect(lockEvent.locked_amount).toBe(ustxAmount);

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
      const expectedUnlockHeight =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(lockEvent.unlock_height).toBe(expectedUnlockHeight);

      // Test the API address balance data after a `stack-stx` operation
      const balance = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(balance.locked).toBe(ustxAmount.toString());
      expect(balance.burnchain_unlock_height).toBe(expectedUnlockHeight);
      expect(balance.lock_height).toBe(dbTx.block_height);
      expect(balance.lock_tx_id).toBe(dbTx.tx_id);
    });

    test('stx unlocked - RPC balance', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccount = await testEnv.client.getAccount(account.stacksAddress);
      await standByUntilBurnBlock(rpcAccount.unlock_height + 1);

      // Check that STX are no longer reported as locked by the RPC endpoints:
      await timeout(200); // make sure unlock was processed
      const rpcAccountAfter = await testEnv.client.getAccount(account.stacksAddress);
      expect(BigInt(rpcAccountAfter.locked)).toBe(0n);
      expect(rpcAccountAfter.unlock_height).toBe(0);
    });

    test('stx unlocked - API balance', async () => {
      // Check that STX are no longer reported as locked by the API endpoints:
      const balance = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(BigInt(balance.locked)).toBe(0n);
      expect(balance.burnchain_unlock_height).toBe(0);
      expect(balance.lock_height).toBe(0);
      expect(balance.lock_tx_id).toBe('');
    });

    test('stacking rewards - API', async () => {
      const slotStart = poxInfo.next_cycle.reward_phase_start_block_height;
      const slotEnd = slotStart + 2; // early in the reward phase

      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      expect(rewards.results).toHaveLength(1);

      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];

      expect(firstReward.reward_recipient).toBe(btcAddr);
      expect(Number(firstReward.burn_amount)).toBeGreaterThan(0);
      expect(firstReward.burn_block_height).toBeGreaterThanOrEqual(slotStart);
      expect(firstReward.burn_block_height).toBeLessThanOrEqual(slotEnd);

      const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
        `/extended/v1/burnchain/rewards/${btcAddr}/total`
      );
      expect(rewardsTotal.reward_recipient).toBe(btcAddr);
      expect(rewardsTotal.reward_amount).toBe(firstReward.burn_amount);

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(btcAddr);
      expect(rewardSlotHolders.results[0].burn_block_height).toBe(firstReward.burn_block_height);
    });

    test('stacking rewards - BTC JSON-RPC - getblock', async () => {
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];

      const blockResult: {
        tx: { vout?: { scriptPubKey: { address?: string }; value?: number }[] }[];
      } = await testEnv.bitcoinRpcClient.getblock({
        blockhash: hexToBuffer(firstReward.burn_block_hash).toString('hex'),
        verbosity: 2,
      });
      const vout = blockResult.tx
        .flatMap(t => t.vout)
        .find(v => v?.value && v.scriptPubKey.address == btcAddrRegtest);
      if (!vout?.value) {
        throw new Error(
          `Could not find bitcoin vout for ${btcAddrRegtest} in block ${firstReward.burn_block_hash}`
        );
      }
      const sats = new bignumber(vout.value).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
    });

    test('stacking rewards - BTC JSON-RPC - listtransactions', async () => {
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];

      let txs = await withDescriptorWallet(
        async walletName =>
          (await testEnv.bitcoinRpcClient.listtransactions(
            {
              label: btcAddrRegtest,
              include_watchonly: true,
            },
            btcDescriptor ? walletName : undefined
          )) as {
            address: string;
            category: string;
            amount: number;
            blockhash: string;
            blockheight: number;
          }[]
      );
      txs = txs.filter(r => r.address === btcAddrRegtest);
      expect(txs.length).toBe(1);
      expect(txs[0].category).toBe('receive');
      expect(txs[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(txs[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
    });

    test('BTC stacking reward received', async () => {
      const received = await withDescriptorWallet(
        async walletName =>
          (await testEnv.bitcoinRpcClient.getreceivedbyaddress(
            {
              address: btcAddrRegtest,
              minconf: 0,
            },
            btcDescriptor ? walletName : undefined
          )) as number
      );
      expect(received).toBeGreaterThan(0);
    });
  }
);

function P2SH_P2WPKH() {
  const btcAddr = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'testnet',
    addressFormat: 'p2sh-p2wpkh',
  });
  expect(btcAddr).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');
  const btcPubKey = privateToPublicKey(BTC_PRIVATE_KEY).toString('hex');
  expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

  const btcAddrDecoded = decodeBtcAddress(btcAddr);
  expect({
    data: Buffer.from(btcAddrDecoded.data).toString('hex'),
    version: btcAddrDecoded.version,
  }).toEqual({ data: '978a0121f9a24de65a13bab0c43c3a48be074eae', version: 1 });

  // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
  const btcAddrRegtest = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'regtest',
    addressFormat: 'p2sh-p2wpkh',
  });
  expect(btcAddrRegtest).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');

  return {
    btcAddr,
    btcAddrDecoded,
    btcAddrRegtest,
    btcPubKey,
    btcDescriptor: undefined,
  };
}

function P2WSH() {
  const btcAddr = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'testnet',
    addressFormat: 'p2wsh',
  });
  expect(btcAddr).toBe('tb1q4qp0380kg75cqv25k4zruwa87wefwz0uefv78jekagm2j8568rwqvz7llf');
  const btcPubKey = privateToPublicKey(BTC_PRIVATE_KEY).toString('hex');
  expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

  const btcAddrDecoded = decodeBtcAddress(btcAddr);
  expect({
    data: Buffer.from(btcAddrDecoded.data).toString('hex'),
    version: btcAddrDecoded.version,
  }).toEqual({
    data: 'a802f89df647a9803154b5443e3ba7f3b29709fcca59e3cb36ea36a91e9a38dc',
    version: 5,
  });

  // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
  const btcAddrRegtest = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'regtest',
    addressFormat: 'p2wsh',
  });
  expect(btcAddrRegtest).toBe('bcrt1q4qp0380kg75cqv25k4zruwa87wefwz0uefv78jekagm2j8568rwqpm5e2n');

  return {
    btcAddr,
    btcAddrDecoded,
    btcAddrRegtest,
    btcPubKey,
    btcDescriptor: undefined,
  };
}

function P2WPKH() {
  const btcAddr = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'testnet',
    addressFormat: 'p2wpkh',
  });
  expect(btcAddr).toBe('tb1qq6hag67dl53wl99vzg42z8eyzfz2xlkvvlryfj');
  const btcPubKey = privateToPublicKey(BTC_PRIVATE_KEY).toString('hex');
  expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

  const btcAddrDecoded = decodeBtcAddress(btcAddr);
  expect({
    data: Buffer.from(btcAddrDecoded.data).toString('hex'),
    version: btcAddrDecoded.version,
  }).toEqual({ data: '06afd46bcdfd22ef94ac122aa11f241244a37ecc', version: 4 });

  // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
  const btcAddrRegtest = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'regtest',
    addressFormat: 'p2wpkh',
  });
  expect(btcAddrRegtest).toBe('bcrt1qq6hag67dl53wl99vzg42z8eyzfz2xlkvwk6f7m');

  return {
    btcAddr,
    btcAddrDecoded,
    btcAddrRegtest,
    btcPubKey,
    btcDescriptor: undefined,
  };
}

function P2TR() {
  const btcAddr = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'testnet',
    addressFormat: 'p2tr',
  });
  expect(btcAddr).toBe('tb1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasvfnc28');
  const btcPubKey = privateToPublicKey(BTC_PRIVATE_KEY).toString('hex');
  expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

  const btcAddrDecoded = decodeBtcAddress(btcAddr);
  expect({
    data: Buffer.from(btcAddrDecoded.data).toString('hex'),
    version: btcAddrDecoded.version,
  }).toEqual({
    data: 'cafd90c7026f0b6ab98df89490d02732881f2f4b5900856358dddff4679c2ffb',
    version: 6,
  });

  // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
  const btcAddrRegtest = getBitcoinAddressFromKey({
    privateKey: BTC_PRIVATE_KEY,
    network: 'regtest',
    addressFormat: 'p2tr',
  });
  expect(btcAddrRegtest).toBe('bcrt1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9laspse7la');

  return {
    btcAddr,
    btcAddrDecoded,
    btcAddrRegtest,
    btcPubKey,
    btcDescriptor: `tr(${btcPubKey})`,
  };
}

// helper
async function withDescriptorWallet<R>(fn: (walletName: string) => Promise<R> | R): Promise<R> {
  // before: load or create descriptor wallet
  try {
    await testEnv.bitcoinRpcClient.loadwallet({ filename: 'descriptor-wallet' });
  } catch (e) {
    await testEnv.bitcoinRpcClient.createwallet({
      wallet_name: 'descriptor-wallet',
      disable_private_keys: true,
      descriptors: true,
      load_on_startup: false,
    } as any);
  }

  const res = await fn('descriptor-wallet');

  // after: unload descriptor walletl
  await testEnv.bitcoinRpcClient.unloadwallet({ wallet_name: 'descriptor-wallet' });

  return res;
}
