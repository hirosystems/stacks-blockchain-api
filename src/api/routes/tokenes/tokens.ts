import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as express from 'express';
import { DataStore } from '../../../datastore/common';
import {
  FungibleTokenMetadataResponse,
  NonFungibleTokenMetadataResponse,
} from '@stacks/stacks-blockchain-api-types';

export function createTokenRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  //router for fungible tokens
  router.getAsync('/ft/metadata', async (req, res) => {
    const { contractId } = req.params;

    const metadata = await db.getFtMetadata(contractId);
    if (!metadata.found) {
      res.status(404).json({ error: 'tokens not found' });
      return;
    }

    const { name, description, image_uri, image_canonical_uri, symbol, decimals } = metadata.result;

    const response: FungibleTokenMetadataResponse = {
      name: name,
      description: description,
      image_uri: image_uri,
      image_canonical_uri: image_canonical_uri,
      symbol: symbol,
      decimals: decimals,
    };
    res.status(200).json(response);
  });

  //router for non-fungible tokens
  router.getAsync('/nft/metadata', async (req, res) => {
    const { contractId } = req.params;
    const metadata = await db.getNftMetadata(contractId);

    if (!metadata.found) {
      res.status(404).json({ error: 'tokens not found' });
      return;
    }
    const { name, description, image_uri, image_canonical_uri } = metadata.result;

    const response: NonFungibleTokenMetadataResponse = {
      name: name,
      description: description,
      image_uri: image_uri,
      image_canonical_uri: image_canonical_uri,
    };
    res.status(200).json(response);
  });

  return router;
}
