import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore, DbBlock } from '../../../datastore/common';
import {
  RosettaPublicKey,
  RosettaConstructionDeriveResponse,
  NetworkIdentifier,
  RosettaOptions,
  RosettaConstructionMetadataResponse,
} from '@blockstack/stacks-blockchain-api-types';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from './../../rosetta-validate';
import { publicKeyToBitcoinAddress, bitcoinAddressToSTXAddress } from './../../../rosetta-helpers';
import { RosettaErrors, RosettaConstants } from '../../rosetta-constants';
import { isValidC32Address, FoundOrNot } from '../../../helpers';
import { StacksCoreRpcClient } from '../../../core-rpc/client';

export function createRosettaConstructionRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/derive', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      //TODO have to fix this and make error generic
      if (valid.error?.includes('should be equal to one of the allowed values')) {
        res.status(400).json(RosettaErrors.invalidCurveType);
      }
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const publicKey: RosettaPublicKey = req.body.public_key;
    const network: NetworkIdentifier = req.body.network_identifier;

    try {
      const btcAddress = publicKeyToBitcoinAddress(publicKey.hex_bytes, network.network);
      if (btcAddress === undefined) {
        res.status(400).json(RosettaErrors.invalidPublicKey);
        return;
      }
      const stxAddress = bitcoinAddressToSTXAddress(btcAddress);

      const response: RosettaConstructionDeriveResponse = {
        address: stxAddress,
      };
      res.json(response);
    } catch (e) {
      res.status(400).json(RosettaErrors.invalidPublicKey);
    }
  });

  router.postAsync('/metadata', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const options: RosettaOptions = req.body.options;
    if (options.type != 'token_transfer') {
      res.status(400).json(RosettaErrors.invalidTransactionType);
      return;
    }

    if (options?.sender_address && !isValidC32Address(options.sender_address)) {
      res.status(400).json(RosettaErrors.invalidSender);
      return;
    }
    if (options?.symbol !== RosettaConstants.symbol) {
      res.status(400).json(RosettaErrors.invalidCurrencySymbol);
      return;
    }

    const recipientAddress = options.token_transfer_recipient_address;
    if (options?.decimals !== RosettaConstants.decimals) {
      res.status(400).json(RosettaErrors.invalidCurrencyDecimals);
      return;
    }

    if (recipientAddress == null || !isValidC32Address(recipientAddress)) {
      res.status(400).json(RosettaErrors.invalidRecipient);
      return;
    }

    const accountInfo = await new StacksCoreRpcClient().getAccount(recipientAddress);
    const nonce = accountInfo.nonce;

    let recentBlockHash = undefined;
    const blockQuery: FoundOrNot<DbBlock> = await db.getCurrentBlock();
    if (blockQuery.found) {
      recentBlockHash = blockQuery.result.block_hash;
    }

    const response: RosettaConstructionMetadataResponse = {
      metadata: {
        ...req.body.options,
        account_sequence: nonce,
        recent_block_hash: recentBlockHash,
      },
    };

    res.json(response);
  });

  return router;
}
