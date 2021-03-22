import * as express from 'express';
import { RouterWithAsync, addAsync } from '@awaitjs/express';
import { DataStore, DbBnsNamespace } from '../../../datastore/common';
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
import { GetStacksNetwork, getBnsContractID } from './../../../bns-helpers';
import {
  BnsGetNamePriceResponse,
  BnsGetNamespacePriceResponse,
} from '@blockstack/stacks-blockchain-api-types';
import { isValidPrincipal, logger } from './../../../helpers';

export function createBnsPriceRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());
  const stacksNetwork = GetStacksNetwork(chainId);

  router.getAsync('/namespaces/:namespace', async (req, res) => {
    const { namespace } = req.params;
    if (namespace.length > 20) {
      res.status(400).json({ error: 'Invalid namespace' });
      return;
    }
    const randomPrivKey = makeRandomPrivKey();
    const address = getAddressFromPrivateKey(
      randomPrivKey.data,
      chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    );
    const bnsContractIdentifier = getBnsContractID(chainId);
    if (!bnsContractIdentifier || !isValidPrincipal(bnsContractIdentifier)) {
      logger.error('BNS contract ID not properly configured');
      return res.status(500).json({ error: 'BNS contract ID not properly configured' });
    }

    const [bnsContractAddress, bnsContractName] = bnsContractIdentifier.split('.');

    const txOptions: ReadOnlyFunctionOptions = {
      senderAddress: address,
      contractAddress: bnsContractAddress,
      contractName: bnsContractName,
      functionName: 'get-namespace-price',
      functionArgs: [bufferCVFromString(namespace)],
      network: stacksNetwork,
    };
    const contractCallTx = await callReadOnlyFunction(txOptions);
    if (
      contractCallTx.type == ClarityType.ResponseOk &&
      contractCallTx.value.type == ClarityType.UInt
    ) {
      const response: BnsGetNamespacePriceResponse = {
        units: 'STX',
        amount: contractCallTx.value.value.toString(10),
      };
      res.json(response);
    } else {
      res.status(400).json({ error: 'Invalid namespace' });
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
    const dbNamespace: DbBnsNamespace = namespaceQuery.result;
    const randomPrivKey = makeRandomPrivKey();
    const address = getAddressFromPrivateKey(
      randomPrivKey.data,
      chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    );
    const buckets = dbNamespace.buckets.split(';').map(x => uintCV(x));

    const bnsContractIdentifier = getBnsContractID(chainId);
    if (!bnsContractIdentifier || !isValidPrincipal(bnsContractIdentifier)) {
      logger.error('BNS contract ID not properly configured');
      return res.status(500).json({ error: 'BNS contract ID not properly configured' });
    }

    const [bnsContractAddress, bnsContractName] = bnsContractIdentifier.split('.');
    const txOptions: ReadOnlyFunctionOptions = {
      senderAddress: address,
      contractAddress: bnsContractAddress,
      contractName: bnsContractName,
      functionName: 'get-name-price',
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
      const response: BnsGetNamePriceResponse = {
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
