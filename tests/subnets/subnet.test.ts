/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as supertest from 'supertest';
import {
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
  testEnv,
} from '../utils/test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnchorMode,
  contractPrincipalCV,
  makeContractCall,
  makeContractDeploy,
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
import { StacksCoreRpcClient } from '../../src/core-rpc/client';
import { StacksTestnet } from '@stacks/network';
import { ClarityTypeID, decodeClarityValue } from '@hirosystems/stacks-encoding-native-js';
import { timeout } from '@hirosystems/api-toolkit';
import {
  TransactionEventsResponse,
  TransactionResults,
} from '../../src/api/schemas/responses/responses';
import { ContractCallTransaction } from '../../src/api/schemas/entities/transactions';

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

  describe('NFT use-case test', () => {
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
        clarityVersion: null as any,
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

    test('Step 2b: Validate register-asset-contract synthetic tx', async () => {
      while (true) {
        const expectedContractID = `ST000000000000000000002AMW42H.subnet`;
        const resp = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx?limit=1&type=contract_call`)
          .expect(200);
        const txListResp = resp.body as TransactionResults;
        const tx = txListResp.results[0] as ContractCallTransaction;
        if (
          txListResp.total === 0 ||
          tx.contract_call.contract_id !== expectedContractID ||
          tx.contract_call.function_name !== 'register-asset-contract'
        ) {
          await timeout(200);
          continue;
        }
        expect(tx).toEqual(
          expect.objectContaining({
            anchor_mode: 'any',
            canonical: true,
            contract_call: {
              contract_id: expectedContractID,
              function_args: [
                expect.objectContaining({
                  name: 'asset-type',
                  repr: '"nft"',
                  type: '(string-ascii 3)',
                }),
                {
                  hex: '0x061a43596b5386f466863e25658ddf94bd0fadab00480d73696d706c652d6e66742d6c31',
                  name: 'l1-contract',
                  repr: `'${accounts.USER.addr}.simple-nft-l1`,
                  type: 'principal',
                },
                {
                  hex: '0x061a43596b5386f466863e25658ddf94bd0fadab00480d73696d706c652d6e66742d6c32',
                  name: 'l2-contract',
                  repr: `'${accounts.USER.addr}.simple-nft-l2`,
                  type: 'principal',
                },
                expect.objectContaining({
                  name: 'burnchain-txid',
                  type: '(buff 32)',
                }),
              ],
              function_name: 'register-asset-contract',
              function_signature:
                '(define-public (register-asset-contract (asset-type (string-ascii 3)) (l1-contract principal) (l2-contract principal) (burnchain-txid (buff 32))))',
            },
            event_count: 1,
            events: [],
            fee_rate: '0',
            post_condition_mode: 'allow',
            post_conditions: [],
            sender_address: 'ST000000000000000000002AMW42H',
            sponsored: false,
            tx_index: 0,
            tx_result: {
              hex: '0x0703',
              repr: '(ok true)',
            },
            tx_status: 'success',
            tx_type: 'contract_call',
          })
        );

        const respEvents = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx/events?tx_id=${tx.tx_id}`)
          .expect(200);
        const txEvents = respEvents.body.events as TransactionEventsResponse['events'];
        expect(txEvents).toEqual([
          {
            contract_log: {
              contract_id: 'ST000000000000000000002AMW42H.subnet',
              topic: 'print',
              value: expect.objectContaining({
                repr: expect.stringContaining(
                  `(l1-contract '${accounts.USER.addr}.simple-nft-l1) (l2-contract '${accounts.USER.addr}.simple-nft-l2)`
                ),
              }),
            },
            event_index: 0,
            event_type: 'smart_contract_log',
            tx_id: tx.tx_id,
          },
        ]);
        break;
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

    test('Step 4a: Deposit the NFT onto the subnet', async () => {
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

    test('Step 4b: Verify deposit-nft-asset synthetic tx', async () => {
      const expectedContractID = `${accounts.USER.addr}.simple-nft-l2`;
      while (true) {
        const resp = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx?limit=1&type=contract_call`)
          .expect(200);
        const txListResp = resp.body as TransactionResults;
        const tx = txListResp.results[0] as ContractCallTransaction;
        if (txListResp.total === 0 || tx.contract_call.contract_id !== expectedContractID) {
          await timeout(200);
          continue;
        }
        expect(tx).toEqual(
          expect.objectContaining({
            anchor_mode: 'any',
            canonical: true,
            contract_call: {
              contract_id: expectedContractID,
              function_args: [
                {
                  hex: '0x0100000000000000000000000000000005',
                  name: 'id',
                  repr: 'u5',
                  type: 'uint',
                },
                {
                  hex: '0x051a43596b5386f466863e25658ddf94bd0fadab0048',
                  name: 'recipient',
                  repr: `'${accounts.USER.addr}`,
                  type: 'principal',
                },
              ],
              function_name: 'deposit-from-burnchain',
              function_signature:
                '(define-public (deposit-from-burnchain (id uint) (recipient principal)))',
            },
            event_count: 1,
            events: [],
            fee_rate: '0',
            post_condition_mode: 'allow',
            post_conditions: [],
            sender_address: accounts.USER.addr,
            sponsored: false,
            tx_index: 0,
            tx_result: {
              hex: '0x0703',
              repr: '(ok true)',
            },
            tx_status: 'success',
            tx_type: 'contract_call',
          })
        );

        const respEvents = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx/events?tx_id=${tx.tx_id}`)
          .expect(200);
        const txEvents = respEvents.body.events as TransactionEventsResponse['events'];
        expect(txEvents).toEqual([
          {
            asset: {
              asset_event_type: 'mint',
              asset_id: `${accounts.USER.addr}.simple-nft-l2::nft-token`,
              recipient: accounts.USER.addr,
              sender: '',
              value: {
                hex: '0x0100000000000000000000000000000005',
                repr: 'u5',
              },
            },
            event_index: 0,
            event_type: 'non_fungible_token_asset',
            tx_id: tx.tx_id,
          },
        ]);
        break;
      }
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
        clarityVersion: null as any,
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

    test('Step 2b: Validate register-asset-contract synthetic tx', async () => {
      while (true) {
        const expectedContractID = `ST000000000000000000002AMW42H.subnet`;
        const resp = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx?limit=1&type=contract_call`)
          .expect(200);
        const txListResp = resp.body as TransactionResults;
        const tx = txListResp.results[0] as ContractCallTransaction;
        if (
          txListResp.total === 0 ||
          tx.contract_call.contract_id !== expectedContractID ||
          tx.contract_call.function_name !== 'register-asset-contract'
        ) {
          await timeout(200);
          continue;
        }
        expect(tx).toEqual(
          expect.objectContaining({
            anchor_mode: 'any',
            canonical: true,
            contract_call: {
              contract_id: expectedContractID,
              function_args: [
                expect.objectContaining({
                  name: 'asset-type',
                  repr: '"ft"',
                  type: '(string-ascii 3)',
                }),
                expect.objectContaining({
                  name: 'l1-contract',
                  repr: `'${accounts.USER.addr}.simple-ft-l1`,
                  type: 'principal',
                }),
                expect.objectContaining({
                  name: 'l2-contract',
                  repr: `'${accounts.USER.addr}.simple-ft-l2`,
                  type: 'principal',
                }),
                expect.objectContaining({
                  name: 'burnchain-txid',
                  type: '(buff 32)',
                }),
              ],
              function_name: 'register-asset-contract',
              function_signature:
                '(define-public (register-asset-contract (asset-type (string-ascii 3)) (l1-contract principal) (l2-contract principal) (burnchain-txid (buff 32))))',
            },
            event_count: 1,
            events: [],
            fee_rate: '0',
            post_condition_mode: 'allow',
            post_conditions: [],
            sender_address: 'ST000000000000000000002AMW42H',
            sponsored: false,
            tx_index: 0,
            tx_result: {
              hex: '0x0703',
              repr: '(ok true)',
            },
            tx_status: 'success',
            tx_type: 'contract_call',
          })
        );

        const respEvents = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx/events?tx_id=${tx.tx_id}`)
          .expect(200);
        const txEvents = respEvents.body.events as TransactionEventsResponse['events'];
        expect(txEvents).toEqual([
          {
            contract_log: {
              contract_id: 'ST000000000000000000002AMW42H.subnet',
              topic: 'print',
              value: expect.objectContaining({
                repr: expect.stringContaining(
                  `(l1-contract '${accounts.USER.addr}.simple-ft-l1) (l2-contract '${accounts.USER.addr}.simple-ft-l2)`
                ),
              }),
            },
            event_index: 0,
            event_type: 'smart_contract_log',
            tx_id: tx.tx_id,
          },
        ]);
        break;
      }
    });

    test('Step 3: Mint FT on the L1 chain', async () => {
      const tx = await makeContractCall({
        contractAddress: accounts.USER.addr,
        contractName: 'simple-ft-l1',
        functionName: 'gift-tokens',
        functionArgs: [uintCV(1), standardPrincipalCV(accounts.USER.addr)],
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

    test('Step 4a: Deposit FT onto the subnet', async () => {
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

    test('Step 4b: Verify deposit-ft-asset synthetic tx', async () => {
      const expectedContractID = `${accounts.USER.addr}.simple-ft-l2`;
      while (true) {
        const resp = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx?limit=1&type=contract_call`)
          .expect(200);
        const txListResp = resp.body as TransactionResults;
        const tx = txListResp.results[0] as ContractCallTransaction;
        if (txListResp.total === 0 || tx.contract_call.contract_id !== expectedContractID) {
          await timeout(200);
          continue;
        }
        expect(tx).toEqual(
          expect.objectContaining({
            anchor_mode: 'any',
            canonical: true,
            contract_call: {
              contract_id: expectedContractID,
              function_args: [
                {
                  hex: '0x0100000000000000000000000000000001',
                  name: 'amount',
                  repr: 'u1',
                  type: 'uint',
                },
                {
                  hex: '0x051a43596b5386f466863e25658ddf94bd0fadab0048',
                  name: 'recipient',
                  repr: `'${accounts.USER.addr}`,
                  type: 'principal',
                },
              ],
              function_name: 'deposit-from-burnchain',
              function_signature:
                '(define-public (deposit-from-burnchain (amount uint) (recipient principal)))',
            },
            event_count: 1,
            events: [],
            fee_rate: '0',
            post_condition_mode: 'allow',
            post_conditions: [],
            sender_address: accounts.USER.addr,
            sponsored: false,
            tx_index: 0,
            tx_result: {
              hex: '0x0703',
              repr: '(ok true)',
            },
            tx_status: 'success',
            tx_type: 'contract_call',
          })
        );

        const respEvents = await supertest(testEnv.api.server)
          .get(`/extended/v1/tx/events?tx_id=${tx.tx_id}`)
          .expect(200);
        const txEvents = respEvents.body.events as TransactionEventsResponse['events'];
        expect(txEvents).toEqual([
          {
            asset: {
              amount: '1',
              asset_event_type: 'mint',
              asset_id: `${accounts.USER.addr}.simple-ft-l2::ft-token`,
              recipient: accounts.USER.addr,
              sender: '',
            },
            event_index: 0,
            event_type: 'fungible_token_asset',
            tx_id: tx.tx_id,
          },
        ]);
        break;
      }
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
        `v2/withdrawal/ft/${withdrawalBlockHeight}/${accounts.ALT_USER.addr}/${withdrawalId}/${accounts.USER.addr}/simple-ft-l2/1`
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
          functionName: 'get-balance',
          functionArgs: [standardPrincipalCV(accounts.ALT_USER.addr)],
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

  describe('STX use-case test', () => {
    test('Step 1: Publish STX contract to L2', async () => {
      const curBlock = await l2Client.getInfo();
      await standByUntilBlock(curBlock.stacks_tip_height + 1);

      const contractName = 'simple-stx-l2';
      const txFee = 100_000n;
      const src = fs.readFileSync(path.resolve(__dirname, 'l2-contracts', `${contractName}.clar`), {
        encoding: 'utf8',
      });
      const tx = await makeContractDeploy({
        senderKey: accounts.USER.key,
        clarityVersion: null as any,
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

    let initialL1StxBalance: bigint;
    let initialL2StxBalance: bigint;
    let depositStxTxId: string;
    let depositStxAmount: number;
    test('Step 2a: Deposit STX into subnet contract on L1', async () => {
      initialL1StxBalance = await l1Client.getAccountBalance(accounts.ALT_USER.addr);
      initialL2StxBalance = await l2Client.getAccountBalance(accounts.ALT_USER.addr);
      depositStxAmount = 12345678;
      const tx = await makeContractCall({
        contractAddress: l1SubnetContract.addr,
        contractName: l1SubnetContract.name,
        functionName: 'deposit-stx',
        functionArgs: [
          uintCV(depositStxAmount), // amount
          standardPrincipalCV(accounts.ALT_USER.addr), // sender
        ],
        senderKey: accounts.ALT_USER.key,
        validateWithAbi: false,
        network: l1Network,
        anchorMode: AnchorMode.OnChainOnly,
        postConditionMode: PostConditionMode.Allow,
        fee: 10000,
      });
      ({ txId: depositStxTxId } = await l1Client.sendTransaction(Buffer.from(tx.serialize())));
      console.log(`[deposit-stx] tx: ${depositStxTxId}`);

      const curBlock = await l1Client.getInfo();
      await standByUntilBurnBlock(curBlock.stacks_tip_height + 1);
    });

    let nextL1Balance: bigint;
    let nextL2Balance: bigint;
    test('Step 2b: Check that user owns additional STX on L2', async () => {
      const curBlock = await l2Client.getInfo();
      await standByUntilBlock(curBlock.stacks_tip_height + 1);
      while (true) {
        nextL1Balance = await l1Client.getAccountBalance(accounts.ALT_USER.addr);
        nextL2Balance = await l2Client.getAccountBalance(accounts.ALT_USER.addr);
        if (nextL1Balance === initialL1StxBalance || nextL2Balance === initialL2StxBalance) {
          console.log({
            txId: depositStxTxId,
            l1Balance: nextL1Balance,
            l2Balance: nextL2Balance,
          });
          await timeout(200);
          continue;
        }
        expect(initialL1StxBalance).toBeGreaterThan(nextL1Balance);
        expect(initialL2StxBalance).toBeLessThan(nextL2Balance);
        break;
      }
    });

    test('Step 2c: Verify deposit-stx synthetic tx', async () => {
      const resp = await supertest(testEnv.api.server)
        .get(`/extended/v1/tx?limit=1&type=token_transfer`)
        .expect(200);
      const txListResp = resp.body as TransactionResults;
      const tx = txListResp.results[0];
      expect(tx).toEqual(
        expect.objectContaining({
          anchor_mode: 'any',
          canonical: true,
          event_count: 1,
          fee_rate: '0',
          nonce: 0,
          post_condition_mode: 'allow',
          post_conditions: [],
          sender_address: 'ST000000000000000000002AMW42H',
          sponsored: false,
          token_transfer: {
            amount: depositStxAmount.toString(),
            memo: '0x',
            recipient_address: accounts.ALT_USER.addr,
          },
          tx_index: 0,
          tx_result: {
            hex: '0x0703',
            repr: '(ok true)',
          },
          tx_status: 'success',
          tx_type: 'token_transfer',
        })
      );

      const respEvents = await supertest(testEnv.api.server)
        .get(`/extended/v1/tx/events?tx_id=${tx.tx_id}`)
        .expect(200);
      const txEvents = respEvents.body.events as TransactionEventsResponse['events'];
      expect(txEvents).toEqual([
        {
          asset: {
            amount: depositStxAmount.toString(),
            asset_event_type: 'mint',
            recipient: accounts.ALT_USER.addr,
            sender: '',
          },
          event_index: 0,
          event_type: 'stx_asset',
          tx_id: tx.tx_id,
        },
      ]);
    });

    let withdrawalBlockHeight: number;
    let withdrawAmount: number;
    test('Step 3: Withdraw STX from L2', async () => {
      withdrawAmount = 1234567;
      const tx = await makeContractCall({
        contractAddress: accounts.USER.addr,
        contractName: 'simple-stx-l2',
        functionName: 'subnet-withdraw-stx',
        functionArgs: [
          uintCV(withdrawAmount), // amount
          standardPrincipalCV(accounts.ALT_USER.addr), // sender
        ],
        senderKey: accounts.ALT_USER.key,
        validateWithAbi: false,
        network: l2Network,
        anchorMode: AnchorMode.OnChainOnly,
        postConditionMode: PostConditionMode.Allow,
        fee: 10000,
      });
      const { txId } = await l2Client.sendTransaction(Buffer.from(tx.serialize()));

      const txResult = await standByForTxSuccess(txId);
      console.log(txResult);

      withdrawalBlockHeight = txResult.block_height;
      console.log(`Withdrawal height: ${withdrawalBlockHeight}`);
    });

    let withdrawStxTxId: string;
    test('Step 4a: Complete the withdrawal on the L1 chain', async () => {
      const withdrawalId = 0;
      const json_merkle_entry = await l2Client.fetchJson<{
        withdrawal_leaf_hash: string;
        withdrawal_root: string;
        sibling_hashes: string;
      }>(
        `v2/withdrawal/stx/${withdrawalBlockHeight}/${accounts.ALT_USER.addr}/${withdrawalId}/${withdrawAmount}`
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
        anchorMode: AnchorMode.OnChainOnly,
        contractAddress: l1SubnetContract.addr,
        contractName: l1SubnetContract.name,
        functionName: 'withdraw-stx',
        functionArgs: [
          uintCV(withdrawAmount), // amount
          standardPrincipalCV(accounts.ALT_USER.addr), // recipient
          uintCV(withdrawalId), // withdrawal ID
          uintCV(withdrawalBlockHeight), // withdrawal block height
          cv_merkle_entry.withdrawal_root, // withdrawal root
          cv_merkle_entry.withdrawal_leaf_hash, // withdrawal leaf hash
          cv_merkle_entry.sibling_hashes,
        ], // sibling hashes
        fee: 10000,
        postConditionMode: PostConditionMode.Allow,
      });

      ({ txId: withdrawStxTxId } = await l1Client.sendTransaction(Buffer.from(tx.serialize())));
    });

    test('Step 4b: Check that user owns additional STX on L1', async () => {
      const curBlock = await l2Client.getInfo();
      await standByUntilBlock(curBlock.stacks_tip_height + 1);
      while (true) {
        const finalL1Balance = await l1Client.getAccountBalance(accounts.ALT_USER.addr);
        const finalL2Balance = await l2Client.getAccountBalance(accounts.ALT_USER.addr);
        if (finalL1Balance === nextL1Balance || finalL2Balance === nextL2Balance) {
          console.log({
            txId: withdrawStxTxId,
            l1Balance: finalL1Balance,
            l2Balance: finalL2Balance,
          });
          await timeout(200);
          continue;
        }
        expect(nextL1Balance).toBeLessThan(finalL1Balance);
        expect(nextL2Balance).toBeGreaterThan(finalL2Balance);
        break;
      }
    });
  });
});
