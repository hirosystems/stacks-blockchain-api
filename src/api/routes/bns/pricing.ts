import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import {
  makeRandomPrivKey,
  getAddressFromPrivateKey,
  TransactionVersion,
  ReadOnlyFunctionOptions,
  bufferCVFromString,
  callReadOnlyFunction,
  ClarityType,
} from '@stacks/transactions';
import {
  BnsGetNamePriceResponse,
  BnsGetNamespacePriceResponse,
} from '@stacks/stacks-blockchain-api-types';
import { ChainID, getChainIDNetwork, isValidPrincipal } from './../../../helpers';
import { PgStore } from '../../../datastore/pg-store';
import { getBnsContractID, GetStacksNetwork } from '../../../event-stream/bns/bns-helpers';
import { logger } from '../../../logger';

export function createBnsPriceRouter(db: PgStore, chainId: ChainID): express.Router {
  const router = express.Router();
  const stacksNetwork = GetStacksNetwork(chainId);

  router.get(
    '/namespaces/:namespace',
    asyncHandler(async (req, res) => {
      const { namespace } = req.params;
      if (namespace.length > 20) {
        res.status(400).json({ error: 'Invalid namespace' });
        return;
      }
      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );
      const bnsContractIdentifier = getBnsContractID(chainId);
      if (!bnsContractIdentifier || !isValidPrincipal(bnsContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        res.status(500).json({ error: 'BNS contract ID not properly configured' });
        return;
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
    })
  );

  router.get(
    '/names/:name',
    asyncHandler(async (req, res) => {
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
      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsContractIdentifier = getBnsContractID(chainId);
      if (!bnsContractIdentifier || !isValidPrincipal(bnsContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        res.status(500).json({ error: 'BNS contract ID not properly configured' });
        return;
      }

      const [bnsContractAddress, bnsContractName] = bnsContractIdentifier.split('.');
      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsContractAddress,
        contractName: bnsContractName,
        functionName: 'get-name-price',
        functionArgs: [bufferCVFromString(namespace), bufferCVFromString(name)],
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
    })
  );

  return router;
}
