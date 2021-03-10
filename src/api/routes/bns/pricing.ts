import * as express from 'express';
import { RouterWithAsync, addAsync } from '@awaitjs/express';
import { DataStore, DbBNSNamespace } from '../../../datastore/common';
import {
  makeRandomPrivKey,
  getAddressFromPrivateKey,
  TransactionVersion,
  ReadOnlyFunctionOptions,
  bufferCVFromString,
  callReadOnlyFunction,
  ClarityType,
  tupleCV,
  uintCV,
  listCV,
  ChainID,
} from '@stacks/transactions';
import { GetStacksNetwork, getBNSContractID } from './../../../bns-helpers';
import {
  BNSGetNamePriceResponse,
  BNSGetNamespacePriceResponse,
} from '@blockstack/stacks-blockchain-api-types';
import { isValidPrincipal, logger } from './../../../helpers';

export function createBNSPriceRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());
  const stacksNetwork = GetStacksNetwork(chainId);

  router.getAsync('/namespaces/:namespace', async (req, res) => {
    const { namespace } = req.params;
    if (namespace.length > 20) {
      res.status(400).json({ error: 'Invalid namespace' });
      return;
    }
    const randomPrivKey = makeRandomPrivKey();
    const address = getAddressFromPrivateKey(randomPrivKey.data, TransactionVersion.Testnet);

    const txOptions: ReadOnlyFunctionOptions = {
      senderAddress: address,
      contractAddress: 'ST000000000000000000002AMW42H',
      contractName: 'bns',
      functionName: 'compute-namespace-price?',
      functionArgs: [bufferCVFromString(namespace)],
      network: stacksNetwork,
    };
    try {
      const contractCallTx = await callReadOnlyFunction(txOptions);
      if (
        contractCallTx.type == ClarityType.ResponseOk &&
        contractCallTx.value.type == ClarityType.UInt
      ) {
        const response: BNSGetNamespacePriceResponse = {
          units: 'STX',
          amount: contractCallTx.value.value.toString(10),
        };
        res.json(response);
      } else {
        res.status(400).json({ error: 'Invalid namespace' });
      }
    } catch (error) {
      res.status(400).json({ error: 'Error calling readOnlyFunction' });
    }
  });

  router.getAsync('/names/:name', async (req, res) => {
    const input = req.params.name;
    if (!input.includes('.')) {
      res.status(400).json({ error: 'Invalid name' });
      return;
    }
    const split = input.split('.');
    if (split.length != 2) {
      res.status(400).json({ error: 'Invalid name' });
      return;
    }
    const name = split[0];
    const namespace = split[1];
    const namespaceQuery = await db.getNamespace({ namespace });
    if (!namespaceQuery.found) {
      res.status(400).json({ error: 'Namespace not exits' });
      return;
    }
    const dbNamespace: DbBNSNamespace = namespaceQuery.result;
    const randomPrivKey = makeRandomPrivKey();
    const address = getAddressFromPrivateKey(
      randomPrivKey.data,
      chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    );
    const buckets = dbNamespace.buckets.split(';').map(x => uintCV(x));

    const bnsContractIdentifier = getBNSContractID(chainId);
    if (!bnsContractIdentifier || !isValidPrincipal(bnsContractIdentifier)) {
      logger.error('BNS contract ID not properly configured');
      return res.status(500).json({ error: 'BNS contract ID not properly configured' });
    }

    const txOptions: ReadOnlyFunctionOptions = {
      senderAddress: address,
      contractAddress: bnsContractIdentifier,
      contractName: 'bns',
      functionName: 'compute-name-price',
      functionArgs: [
        bufferCVFromString(name),
        tupleCV({
          buckets: listCV(buckets),
          base: uintCV(dbNamespace.base),
          coeff: uintCV(dbNamespace.coeff),
          'nonalpha-discount': uintCV(dbNamespace.nonalpha_discount),
          'no-vowel-discount': uintCV(dbNamespace.no_vowel_discount),
        }),
      ],
      network: stacksNetwork,
    };

    const contractCall = await callReadOnlyFunction(txOptions);
    if (
      contractCall.type == ClarityType.ResponseOk &&
      contractCall.value.type == ClarityType.UInt
    ) {
      const response: BNSGetNamePriceResponse = {
        units: 'STX',
        amount: contractCall.value.value.toString(10),
      };
      res.json(response);
    } else {
      res.status(400).json({ error: 'Invalid name' });
    }
  });

  return router;
}
