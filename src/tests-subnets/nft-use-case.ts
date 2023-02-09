/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { RunFaucetResponse } from '@stacks/stacks-blockchain-api-types';
import { AddressStxBalanceResponse } from 'docs/generated';
import * as supertest from 'supertest';
import {
  Account,
  accountFromKey,
  fetchGet,
  standByForTxSuccess,
  standByUntilBlock,
  testEnv,
} from '../test-utils/test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import { AnchorMode, makeContractDeploy, StacksTransaction } from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { StacksTestnet } from '@stacks/network';
import { timeout } from '../helpers';

describe('Subnets NFT use-case', () => {
  let l1Client: StacksCoreRpcClient;
  let l1StacksNetwork: StacksTestnet;

  let l1Account: Account;

  const subnetAccountKey = 'b1ee37d996b1cf95ff67996a38426cff398d3adfeccf8ae8b3651a530837dd5801';
  let subnetAccount: Account;

  beforeAll(() => {
    l1Client = new StacksCoreRpcClient({ port: 20443 });
    l1StacksNetwork = new StacksTestnet({ url: `http://${l1Client.endpoint}` });

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
        network: l1StacksNetwork,
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
        const accountInfo = await testEnv.client.getAccount(l1Account.stxAddr);
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
});
