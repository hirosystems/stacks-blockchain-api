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
  deserializeCV,
  someCV,
  callReadOnlyFunction,
  cvToString,
  noneCV,
} from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { StacksTestnet } from '@stacks/network';
import { timeout } from '../helpers';
import { ClarityTypeID, decodeClarityValue } from 'stacks-encoding-native-js';

describe('Subnets tests', () => {
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

  let l1SubnetContract: {
    addr: string;
    name: string;
  };

  let l2SubnetContract: {
    addr: string;
    name: string;
  };

  beforeAll(() => {
    l1Client = new StacksCoreRpcClient({ port: 20443 });
    l1Network = new StacksTestnet({ url: `http://${l1Client.endpoint}` });

    l2Client = testEnv.client;
    l2Network = testEnv.stacksNetwork;

    l1SubnetContract = {
      addr: accounts.SUBNET_CONTRACT_DEPLOYER.addr,
      name: 'subnet',
    };

    l2SubnetContract = {
      addr: 'ST000000000000000000002AMW42H',
      name: 'subnet',
    };
  });

  test('Wait for L1 to be ready', async () => {
    while (true) {
      try {
        const info = await l1Client.getInfo();
        if (info.stacks_tip_height >= 2) {
          break;
        }
        await timeout(200);
      } catch (error) {
        await timeout(200);
      }
    }
  });

  test('Deploy L1 contract dependencies', async () => {
    const contracts: { name: string; clarityVersion: number }[] = [
      { name: 'nft-trait', clarityVersion: 1 },
      { name: 'sip-010-trait-ft-standard', clarityVersion: 1 },
      { name: 'sip-traits', clarityVersion: 1 },
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
            `v2/contracts/interface/${accounts.SUBNET_CONTRACT_DEPLOYER.addr}/${c.name}`
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

  describe.skip('NFT use-case test', () => {
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
      await standByUntilBlock(curBlock.stacks_tip_height + 1);

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
        contractAddress: l1SubnetContract.addr,
        contractName: l1SubnetContract.name,
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
      while (true) {
        try {
          const tx = await makeContractCall({
            contractAddress: l1SubnetContract.addr,
            contractName: l1SubnetContract.name,
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
          break;
        } catch (error) {
          if ((error as Error).toString().includes('ConflictingNonceInMempool')) {
            await timeout(200);
          } else {
            throw error;
          }
        }
      }

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

    let withdrawalBlockHeight: number;
    test('Step 6a: Withdraw the NFT on the subnet', async () => {
      const tx = await makeContractCall({
        contractAddress: l2SubnetContract.addr,
        contractName: l2SubnetContract.name,
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

      withdrawalBlockHeight = txResult.block_height;
      console.log(`Withdrawal height: ${withdrawalBlockHeight}`);
    });

    test('Step 6b: Complete the withdrawal on the Stacks chain', async () => {
      const withdrawalId = 0;
      const json_merkle_entry = await l2Client.fetchJson<{
        withdrawal_leaf_hash: string;
        withdrawal_root: string;
        sibling_hashes: string;
      }>(
        `v2/withdrawal/nft/${withdrawalBlockHeight}/${accounts.ALT_USER.addr}/${withdrawalId}/${accounts.USER.addr}/simple-nft-l2/5`
      );
      console.log(json_merkle_entry);
      const cv_merkle_entry = {
        withdrawal_leaf_hash: deserializeCV(json_merkle_entry.withdrawal_leaf_hash),
        withdrawal_root: deserializeCV(json_merkle_entry.withdrawal_root),
        sibling_hashes: deserializeCV(json_merkle_entry.sibling_hashes),
      };
      console.log(cv_merkle_entry);

      const tx = await makeContractCall({
        senderKey: accounts.ALT_USER.key,
        network: l1Network,
        anchorMode: AnchorMode.Any,
        contractAddress: l1SubnetContract.addr,
        contractName: l1SubnetContract.name,
        functionName: 'withdraw-nft-asset',
        functionArgs: [
          contractPrincipalCV(accounts.USER.addr, 'simple-nft-l1'), // nft-contract
          uintCV(5), // ID
          standardPrincipalCV(accounts.ALT_USER.addr), // recipient
          uintCV(withdrawalId), // withdrawal ID
          uintCV(withdrawalBlockHeight), // withdrawal block height
          someCV(contractPrincipalCV(accounts.USER.addr, 'simple-nft-l1')), // nft-mint-contract
          cv_merkle_entry.withdrawal_root, // withdrawal root
          cv_merkle_entry.withdrawal_leaf_hash, // withdrawal leaf hash
          cv_merkle_entry.sibling_hashes,
        ], // sibling hashes
        fee: 10000,
        postConditionMode: PostConditionMode.Allow,
      });

      await l1Client.sendTransaction(Buffer.from(tx.serialize()));

      while (true) {
        const result = await callReadOnlyFunction({
          contractAddress: accounts.USER.addr,
          contractName: 'simple-nft-l1',
          functionName: 'get-owner',
          functionArgs: [uintCV(5)],
          network: l1Network,
          senderAddress: accounts.ALT_USER.addr,
        });
        const resultString = cvToString(result);
        console.log(resultString);
        if (!resultString.includes(accounts.ALT_USER.addr)) {
          await timeout(500);
          continue;
        }
        expect(resultString).toContain(accounts.ALT_USER.addr);
        break;
      }
    });
  });

  describe('FT use-case test', () => {
    test('Step 1a: Publish FT contract to L1', async () => {
      const contractName = 'simple-ft-l1';
      const txFee = 100_000n;
      const src = fs.readFileSync(path.resolve(__dirname, 'l1-contracts', `${contractName}.clar`), {
        encoding: 'utf8',
      });
      const tx = await makeContractDeploy({
        senderKey: accounts.USER.key,
        clarityVersion: 2,
        contractName: contractName,
        codeBody: src,
        network: l1Network,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
      });
      const { txId } = await l1Client.sendTransaction(Buffer.from(tx.serialize()));

      const curBlock = await l1Client.getInfo();
      await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);

      while (true) {
        try {
          await l1Client.fetchJson(`v2/contracts/interface/${accounts.USER.addr}/${contractName}`);
          break;
        } catch (error) {
          console.error(error);
          await timeout(200);
        }
      }
    });

    test('Step 1b: Publish FT contract to L2', async () => {
      const curBlock = await l2Client.getInfo();
      await standByUntilBlock(curBlock.stacks_tip_height + 1);

      const contractName = 'simple-ft-l2';
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

    test('Step 2: Register FT asset in the interface subnet contract', async () => {
      const accountNonce = await l1Client.getAccountNonce(accounts.AUTH_SUBNET_MINER.addr);
      const tx = await makeContractCall({
        contractAddress: l1SubnetContract.addr,
        contractName: l1SubnetContract.name,
        functionName: 'register-new-ft-contract',
        functionArgs: [
          contractPrincipalCV(accounts.USER.addr, 'simple-ft-l1'),
          contractPrincipalCV(accounts.USER.addr, 'simple-ft-l2'),
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
        serializeCV(contractPrincipalCV(accounts.USER.addr, 'simple-ft-l1'))
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
          expect(mapValue.repr).toContain('simple-ft-l2');
          break;
        }
        await timeout(300);
      }
    });

    test('Step 3: Mint FT on the L1 chain', async () => {
      const tx = await makeContractCall({
        contractAddress: accounts.USER.addr,
        contractName: 'simple-ft-l1',
        functionName: 'gift-tokens',
        functionArgs: [standardPrincipalCV(accounts.USER.addr)],
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

    test('Step 4: Deposit FT onto the subnet', async () => {
      while (true) {
        try {
          const tx = await makeContractCall({
            contractAddress: l1SubnetContract.addr,
            contractName: l1SubnetContract.name,
            functionName: 'deposit-ft-asset',
            functionArgs: [
              contractPrincipalCV(accounts.USER.addr, 'simple-ft-l1'), // contract ID of ft contract on L1
              uintCV(1), // amount
              standardPrincipalCV(accounts.USER.addr), // sender
              noneCV(), // optional memo
            ],
            senderKey: accounts.USER.key,
            validateWithAbi: false,
            network: l1Network,
            anchorMode: AnchorMode.Any,
            postConditionMode: PostConditionMode.Allow,
            fee: 10000,
          });
          const { txId } = await l1Client.sendTransaction(Buffer.from(tx.serialize()));
          break;
        } catch (error) {
          if ((error as Error).toString().includes('ConflictingNonceInMempool')) {
            await timeout(200);
          } else {
            throw error;
          }
        }
      }

      const curBlock = await l1Client.getInfo();
      await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);
    });

    test('Step 5: Transfer FT within the subnet', async () => {
      const tx = await makeContractCall({
        contractAddress: accounts.USER.addr,
        contractName: 'simple-ft-l2',
        functionName: 'transfer',
        functionArgs: [
          uintCV(1), // amount
          standardPrincipalCV(accounts.USER.addr), // sender
          standardPrincipalCV(accounts.ALT_USER.addr), // recipient
          noneCV(), // optional memo
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

    let withdrawalBlockHeight: number;
    test('Step 6a: Withdraw FT on the subnet', async () => {
      const tx = await makeContractCall({
        contractAddress: l2SubnetContract.addr,
        contractName: l2SubnetContract.name,
        functionName: 'ft-withdraw?',
        functionArgs: [
          contractPrincipalCV(accounts.USER.addr, 'simple-ft-l2'),
          uintCV(1), // amount
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

      withdrawalBlockHeight = txResult.block_height;
      console.log(`Withdrawal height: ${withdrawalBlockHeight}`);
    });

    // TODO: subnets have not yet implemented the `/v2/withdrawal/ft/...` endpoint required for this test
    test.skip('Step 6b: Complete the withdrawal on the Stacks chain', async () => {
      const withdrawalId = 0;
      const json_merkle_entry = await l2Client.fetchJson<{
        withdrawal_leaf_hash: string;
        withdrawal_root: string;
        sibling_hashes: string;
      }>(
        `v2/withdrawal/ft/${withdrawalBlockHeight}/${accounts.ALT_USER.addr}/${withdrawalId}/${accounts.USER.addr}/simple-ft-l2/5`
      );
      console.log(json_merkle_entry);
      const cv_merkle_entry = {
        withdrawal_leaf_hash: deserializeCV(json_merkle_entry.withdrawal_leaf_hash),
        withdrawal_root: deserializeCV(json_merkle_entry.withdrawal_root),
        sibling_hashes: deserializeCV(json_merkle_entry.sibling_hashes),
      };
      console.log(cv_merkle_entry);

      const tx = await makeContractCall({
        senderKey: accounts.ALT_USER.key,
        network: l1Network,
        anchorMode: AnchorMode.Any,
        contractAddress: l1SubnetContract.addr,
        contractName: l1SubnetContract.name,
        functionName: 'withdraw-ft-asset',
        functionArgs: [
          contractPrincipalCV(accounts.USER.addr, 'simple-ft-l1'), // ft-contract
          uintCV(1), // amount
          standardPrincipalCV(accounts.ALT_USER.addr), // recipient
          uintCV(withdrawalId), // withdrawal ID
          uintCV(withdrawalBlockHeight), // withdrawal block height
          noneCV(), // optional memo
          someCV(contractPrincipalCV(accounts.USER.addr, 'simple-ft-l1')), // ft-mint-contract
          cv_merkle_entry.withdrawal_root, // withdrawal root
          cv_merkle_entry.withdrawal_leaf_hash, // withdrawal leaf hash
          cv_merkle_entry.sibling_hashes,
        ], // sibling hashes
        fee: 10000,
        postConditionMode: PostConditionMode.Allow,
      });

      await l1Client.sendTransaction(Buffer.from(tx.serialize()));

      while (true) {
        const result = await callReadOnlyFunction({
          contractAddress: accounts.USER.addr,
          contractName: 'simple-ft-l1',
          functionName: 'get-owner',
          functionArgs: [uintCV(5)],
          network: l1Network,
          senderAddress: accounts.ALT_USER.addr,
        });
        const resultString = cvToString(result);
        console.log(resultString);
        if (!resultString.includes(accounts.ALT_USER.addr)) {
          await timeout(500);
          continue;
        }
        expect(resultString).toContain(accounts.ALT_USER.addr);
        break;
      }
    });
  });
});