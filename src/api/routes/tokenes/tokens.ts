import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as express from 'express';
import { DataStore } from '../../../datastore/common';
import { FTMetadataResponse, NFTMetadataResponse } from '@blockstack/stacks-blockchain-api-types';

export function createTokenRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  //router for fungible tokens
  router.getAsync('/ft/metadata', async (req, res) => {
    const { contractId } = req.params;

    const metadata = await db.getftMetadata(contractId);
    if (!metadata.found) {
      res.status(404).json({ error: 'tokens not found' });
      return;
    }

    const response: FTMetadataResponse = {
      name: 'sample asset name',
      description: 'sample asset description',
      image_uri: 'image uri',
      image_canonical_uri: 'canonical image uri',
    };
    res.send(response);
  });

  //router for non-fungible tokens
  router.getAsync('/nft/metadata', async (req, res) => {
    const { contractId } = req.params;
    const metadata = await db.getNftMetadata(contractId);

    if (!metadata.found) {
      res.status(404).json({ error: 'tokens not found' });
      return;
    }

    const response: NFTMetadataResponse = {
      name: metadata.result.name,
      description: metadata.result.description,
      image_uri: metadata.result.image_uri,
      image_canonical_uri: metadata.result.image_canonical_uri,
    };
    res.send(response);
  });

  return router;
}
