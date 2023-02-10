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

  const accounts = {
    SUBNET_CONTRACT_DEPLOYER: {
      addr: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      key: 'e75dcb66f84287eaf347955e94fa04337298dbd95aa0dbb985771104ef1913db01',
    },
    AUTH_SUBNET_MINER: {
      addr: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      key: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
    },
    USER: {
      addr: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      key: '21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601',
    },
    ALT_USER: {
      addr: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      key: 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01',
    },
  };

  beforeAll(() => {
    l1Client = new StacksCoreRpcClient({ port: 20443 });
    l1Network = new StacksTestnet({ url: `http://${l1Client.endpoint}` });

    l2Client = testEnv.client;
    l2Network = testEnv.stacksNetwork;
  });

  test('Deploy L1 contract dependencies', async () => {
    const contracts: { name: string; clarityVersion: number }[] = [
      { name: 'nft-trait', clarityVersion: 1 },
      { name: 'sip-010-trait-ft-standard', clarityVersion: 1 },
      { name: 'subnet-traits', clarityVersion: 1 },
      { name: 'subnet', clarityVersion: 2 },
    ];

    const accountInfo = await l1Client.getAccount(accounts.SUBNET_CONTRACT_DEPLOYER.addr);
    let accountNonce = accountInfo.nonce;
    const txFee = 100_000n;
    for (const c of contracts) {
      const src = fs.readFileSync(path.resolve(__dirname, 'l1-contracts', `${c.name}.clar`), {
        encoding: 'utf8',
      });
      const tx = await makeContractDeploy({
        senderKey: accounts.SUBNET_CONTRACT_DEPLOYER.key,
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
            `v2/contracts/interface/${accounts.SUBNET_CONTRACT_DEPLOYER.addr}/${c.name}?tip=latest`
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
        const accountInfo = await l2Client.getAccount(accounts.SUBNET_CONTRACT_DEPLOYER.addr);
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

  test('Step 1a: Publish NFT contract to L1', async () => {
    const contractName = 'simple-nft-l1';
    const txFee = 100_000n;
    const src = fs.readFileSync(path.resolve(__dirname, 'l1-contracts', `${contractName}.clar`), {
      encoding: 'utf8',
    });
    const tx = await makeContractDeploy({
      senderKey: accounts.USER.key,
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
        await l1Client.fetchJson(`v2/contracts/interface/${accounts.USER.addr}/${contractName}`);
        break;
      } catch (error) {
        await timeout(200);
      }
    }
  });

  test('Step 1b: Publish NFT contract to L2', async () => {
    const curBlock = await l2Client.getInfo();
    await standByUntilBlock(curBlock.stacks_tip_height + 2);

    const contractName = 'simple-nft-l2';
    const txFee = 100_000n;
    const src = fs.readFileSync(path.resolve(__dirname, 'l2-contracts', `${contractName}.clar`), {
      encoding: 'utf8',
    });
    const tx = await makeContractDeploy({
      senderKey: accounts.USER.key,
      // clarityVersion: 1,
      contractName: contractName,
      codeBody: src,
      network: l2Network,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
    });
    const { txId } = await l2Client.sendTransaction(Buffer.from(tx.serialize()));
    const txResult = await standByForTxSuccess(txId);
    console.log(txResult);
  });

  test('Step 2: Register NFT asset in the interface subnet contract', async () => {
    const accountNonce = await l1Client.getAccountNonce(accounts.AUTH_SUBNET_MINER.addr);
    const tx = await makeContractCall({
      contractAddress: accounts.SUBNET_CONTRACT_DEPLOYER.addr,
      contractName: 'subnet',
      functionName: 'register-new-nft-contract',
      functionArgs: [
        contractPrincipalCV(accounts.USER.addr, 'simple-nft-l1'),
        contractPrincipalCV(accounts.USER.addr, 'simple-nft-l2'),
      ],
      senderKey: accounts.AUTH_SUBNET_MINER.key,
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
      serializeCV(contractPrincipalCV(accounts.USER.addr, 'simple-nft-l1'))
    ).toString('hex');
    while (true) {
      const mapLookupResult = await l1Client.fetchJson<{ data: string }>(
        `v2/map_entry/${accounts.SUBNET_CONTRACT_DEPLOYER.addr}/subnet/allowed-contracts`,
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

  test('Step 3: Mint an NFT on the L1 chain', async () => {
    const tx = await makeContractCall({
      contractAddress: accounts.USER.addr,
      contractName: 'simple-nft-l1',
      functionName: 'gift-nft',
      functionArgs: [standardPrincipalCV(accounts.USER.addr), uintCV(5)],
      senderKey: accounts.USER.key,
      validateWithAbi: false,
      network: l1Network,
      anchorMode: AnchorMode.Any,
      fee: 10000,
    });
    const { txId } = await l1Client.sendTransaction(Buffer.from(tx.serialize()));

    const curBlock = await l1Client.getInfo();
    await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);
  });

  test('Step 4: Deposit the NFT onto the subnet', async () => {
    const tx = await makeContractCall({
      contractAddress: accounts.SUBNET_CONTRACT_DEPLOYER.addr,
      contractName: 'subnet',
      functionName: 'deposit-nft-asset',
      functionArgs: [
        contractPrincipalCV(accounts.USER.addr, 'simple-nft-l1'), // contract ID of nft contract on L1
        uintCV(5), // ID
        standardPrincipalCV(accounts.USER.addr), // sender
      ],
      senderKey: accounts.USER.key,
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

  test('Step 5: Transfer the NFT within the subnet', async () => {
    const tx = await makeContractCall({
      contractAddress: accounts.USER.addr,
      contractName: 'simple-nft-l2',
      functionName: 'transfer',
      functionArgs: [
        uintCV(5), // ID
        standardPrincipalCV(accounts.USER.addr), // sender
        standardPrincipalCV(accounts.ALT_USER.addr), // recipient
      ],
      senderKey: accounts.USER.key,
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

  let WITHDRAWAL_BLOCK_HEIGHT: number;
  test('Step 6a: Withdraw the NFT on the subnet', async () => {
    const tx = await makeContractCall({
      contractAddress: 'ST000000000000000000002AMW42H',
      contractName: 'subnet',
      functionName: 'nft-withdraw?',
      functionArgs: [
        contractPrincipalCV(accounts.USER.addr, 'simple-nft-l2'),
        uintCV(5), // ID
        standardPrincipalCV(accounts.ALT_USER.addr), // recipient
      ],
      senderKey: accounts.ALT_USER.key,
      validateWithAbi: false,
      network: l2Network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      fee: 10000,
    });
    const { txId } = await l2Client.sendTransaction(Buffer.from(tx.serialize()));

    const txResult = await standByForTxSuccess(txId);
    console.log(txResult);

    WITHDRAWAL_BLOCK_HEIGHT = txResult.block_height;
    console.log(`Withdrawal height: ${WITHDRAWAL_BLOCK_HEIGHT}`);
  });

  /*
  test('Step 6b: Complete the withdrawal on the Stacks chain', async () => {

  });
  */
});
