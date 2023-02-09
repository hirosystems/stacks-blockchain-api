/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { RunFaucetResponse } from '@stacks/stacks-blockchain-api-types';
import { AddressStxBalanceResponse } from 'docs/generated';
import * as supertest from 'supertest';
import {
  Account,
  accountFromKey,
  fetchGet,
  readOnlyFnCall,
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnchorMode,
  contractPrincipalCV,
  makeContractCall,
  makeContractDeploy,
  StacksTransaction,
  serializeCV,
  standardPrincipalCV,
  uintCV,
  PostConditionMode,
} from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { StacksTestnet } from '@stacks/network';
import { timeout } from '../helpers';
import { ClarityTypeID, decodeClarityValue } from 'stacks-encoding-native-js';

describe('Subnets NFT use-case', () => {
  let l1Client: StacksCoreRpcClient;
  let l1Network: StacksTestnet;

  let l2Client: StacksCoreRpcClient;
  let l2Network: StacksTestnet;

  let l1Account: Account;

  const subnetAccountKey = 'b1ee37d996b1cf95ff67996a38426cff398d3adfeccf8ae8b3651a530837dd5801';
  let subnetAccount: Account;

  beforeAll(() => {
    l1Client = new StacksCoreRpcClient({ port: 20443 });
    l1Network = new StacksTestnet({ url: `http://${l1Client.endpoint}` });

    l2Client = testEnv.client;
    l2Network = testEnv.stacksNetwork;

    l1Account = accountFromKey(testnetKeys[0].secretKey);
    subnetAccount = accountFromKey(subnetAccountKey);
  });

  test('Deploy L1 contract dependencies', async () => {
    const contracts: { name: string; clarityVersion: number }[] = [
      { name: 'nft-trait', clarityVersion: 1 },
      { name: 'sip-010-trait-ft-standard', clarityVersion: 1 },
      { name: 'subnet-traits', clarityVersion: 1 },
      { name: 'subnet', clarityVersion: 2 },
    ];

    const accountInfo = await l1Client.getAccount(l1Account.stxAddr);
    let accountNonce = accountInfo.nonce;
    const txFee = 100_000n;
    for (const c of contracts) {
      const src = fs.readFileSync(path.resolve(__dirname, 'l1-contracts', `${c.name}.clar`), {
        encoding: 'utf8',
      });
      const tx = await makeContractDeploy({
        senderKey: l1Account.secretKey,
        clarityVersion: c.clarityVersion,
        contractName: c.name,
        codeBody: src,
        nonce: accountNonce++,
        network: l1Network,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
      });
      await l1Client.sendTransaction(Buffer.from(tx.serialize()));
    }

    // Ensure each contract was deployed
    for (const c of contracts) {
      while (true) {
        try {
          await l1Client.fetchJson(
            `v2/contracts/interface/${l1Account.stxAddr}/${c.name}?tip=latest`
          );
          break;
        } catch (error) {
          await timeout(200);
        }
      }
    }
  });

  test('Ensure subnet RPC is responsive', async () => {
    while (true) {
      try {
        const accountInfo = await l2Client.getAccount(l1Account.stxAddr);
        console.log(accountInfo);
        break;
      } catch (error) {
        console.log(`Error: ${error}`);
        await timeout(500);
      }
    }
  });

  test('Test first subnet block mined', async () => {
    const block = await standByUntilBlock(1);
    expect(block).toBeTruthy();
  });

  const AUTH_SUBNET_MINER_ADDR = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
  const AUTH_SUBNET_MINER_KEY =
    'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01';

  const USER_ADDR = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
  const USER_KEY = '21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601';

  const ALT_USER_ADDR = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
  const ALT_USER_KEY = 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01';

  test('Publish NFT contract to L1', async () => {
    const contractName = 'simple-nft-l1';
    const txFee = 100_000n;
    const src = fs.readFileSync(path.resolve(__dirname, 'l1-contracts', `${contractName}.clar`), {
      encoding: 'utf8',
    });
    const tx = await makeContractDeploy({
      senderKey: USER_KEY,
      clarityVersion: 1,
      contractName: contractName,
      codeBody: src,
      network: l1Network,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
    });
    await l1Client.sendTransaction(Buffer.from(tx.serialize()));

    const curBlock = await l1Client.getInfo();
    await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);

    while (true) {
      try {
        await l1Client.fetchJson(`v2/contracts/interface/${USER_ADDR}/${contractName}`);
        break;
      } catch (error) {
        await timeout(200);
      }
    }
  });

  test('Publish NFT contract to L2', async () => {
    const contractName = 'simple-nft-l2';
    const txFee = 100_000n;
    const src = fs.readFileSync(path.resolve(__dirname, 'l2-contracts', `${contractName}.clar`), {
      encoding: 'utf8',
    });
    const tx = await makeContractDeploy({
      senderKey: USER_KEY,
      // clarityVersion: 1,
      contractName: contractName,
      codeBody: src,
      network: l2Network,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
    });
    const { txId } = await l2Client.sendTransaction(Buffer.from(tx.serialize()));
    await standByForTxSuccess(txId);

    /*
    const curBlock = await l2Client.getInfo();
    await standByUntilBlock(curBlock.stacks_tip_height + 1);

    while (true) {
      try {
        await l2Client.fetchJson(`v2/contracts/interface/${USER_ADDR}/${contractName}`);
        break;
      } catch (error) {
        await timeout(200);
      }
    }
    */
  });

  test('Register NFT asset in the interface subnet contract', async () => {
    const accountNonce = await l1Client.getAccountNonce(AUTH_SUBNET_MINER_ADDR);
    const tx = await makeContractCall({
      contractAddress: l1Account.stxAddr,
      contractName: 'subnet',
      functionName: 'register-new-nft-contract',
      functionArgs: [
        contractPrincipalCV(USER_ADDR, 'simple-nft-l1'),
        contractPrincipalCV(USER_ADDR, 'simple-nft-l2'),
      ],
      senderKey: AUTH_SUBNET_MINER_KEY,
      validateWithAbi: false,
      network: l1Network,
      anchorMode: AnchorMode.Any,
      fee: 10000,
      nonce: accountNonce + 1,
    });
    const { txId } = await l1Client.sendTransaction(Buffer.from(tx.serialize()));

    const curBlock = await l1Client.getInfo();
    await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);

    // (define-map allowed-contracts principal principal)
    // Verify `allowed-contracts` map in subnets contract was updated
    const principalArg = Buffer.from(
      serializeCV(contractPrincipalCV(USER_ADDR, 'simple-nft-l1'))
    ).toString('hex');
    while (true) {
      const mapLookupResult = await l1Client.fetchJson<{ data: string }>(
        `v2/map_entry/${l1Account.stxAddr}/subnet/allowed-contracts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(principalArg),
        }
      );
      const mapValue = decodeClarityValue(mapLookupResult.data);
      if (mapValue.type_id === ClarityTypeID.OptionalSome) {
        expect(mapValue.repr).toContain('simple-nft-l2');
        break;
      }
      await timeout(300);
    }
  });

  test('Mint an NFT on the L1 chain', async () => {
    const tx = await makeContractCall({
      contractAddress: USER_ADDR,
      contractName: 'simple-nft-l1',
      functionName: 'gift-nft',
      functionArgs: [standardPrincipalCV(USER_ADDR), uintCV(5)],
      senderKey: USER_KEY,
      validateWithAbi: false,
      network: l1Network,
      anchorMode: AnchorMode.Any,
      fee: 10000,
    });
    const { txId } = await l1Client.sendTransaction(Buffer.from(tx.serialize()));

    const curBlock = await l1Client.getInfo();
    await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);
  });

  test('Deposit the NFT onto the subnet', async () => {
    const tx = await makeContractCall({
      contractAddress: l1Account.stxAddr,
      contractName: 'subnet',
      functionName: 'deposit-nft-asset',
      functionArgs: [
        contractPrincipalCV(USER_ADDR, 'simple-nft-l1'), // contract ID of nft contract on L1
        uintCV(5), // ID
        standardPrincipalCV(USER_ADDR), // sender
      ],
      senderKey: USER_KEY,
      validateWithAbi: false,
      network: l1Network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      fee: 10000,
    });
    const { txId } = await l1Client.sendTransaction(Buffer.from(tx.serialize()));

    const curBlock = await l1Client.getInfo();
    await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);
  });

  test('Transfer the NFT within the subnet', async () => {
    const tx = await makeContractCall({
      contractAddress: USER_ADDR,
      contractName: 'simple-nft-l2',
      functionName: 'transfer',
      functionArgs: [
        uintCV(5), // ID
        standardPrincipalCV(USER_ADDR), // sender
        standardPrincipalCV(ALT_USER_ADDR), // recipient
      ],
      senderKey: USER_KEY,
      validateWithAbi: false,
      network: l2Network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      fee: 10000,
    });
    const { txId } = await l2Client.sendTransaction(Buffer.from(tx.serialize()));

    const txResult = await standByForTxSuccess(txId);
    console.log(txResult);
  });
});
