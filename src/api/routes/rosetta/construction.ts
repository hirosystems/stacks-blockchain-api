import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import {
  RosettaPublicKey,
  RosettaConstructionDeriveResponse,
  NetworkIdentifier,
} from '@blockstack/stacks-blockchain-api-types';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from './../../rosetta-validate';
import { publicKeyToBitcoinAddress, bitcoinAddressToSTXAddress } from './../../../rosetta-helpers';
import { RosettaErrors } from '../../rosetta-constants';

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

  return router;
}
