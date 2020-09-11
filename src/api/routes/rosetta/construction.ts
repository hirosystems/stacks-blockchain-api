import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import {
  RosettaPublicKey,
  RosettaConstructionDeriveResponse,
} from '@blockstack/stacks-blockchain-api-types';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from './../../rosetta-validate';
import { publicKeyToAddress, convertToSTXAddress } from './../../../rosetta-helpers';

export function createRosettaConstructionRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/derive', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const publicKey: RosettaPublicKey = req.body.public_key;
    const btcAddress = publicKeyToAddress(publicKey.hex_bytes);
    const stxAddress = convertToSTXAddress(btcAddress);

    const response: RosettaConstructionDeriveResponse = {
      address: stxAddress,
    };

    res.json(response);
  });

  return router;
}
