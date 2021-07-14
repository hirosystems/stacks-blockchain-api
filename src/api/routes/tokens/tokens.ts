import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as express from 'express';
import { DataStore } from '../../../datastore/common';
import {
  FungibleTokenMetadataResponse,
  NonFungibleTokenMetadataResponse,
} from '@stacks/stacks-blockchain-api-types';
import { parseLimitQuery, parsePagingQueryInput } from './../../pagination';

const MAX_TOKENS_PER_REQUEST = 200;
const parseTokenQueryLimit = parseLimitQuery({
  maxItems: MAX_TOKENS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TOKENS_PER_REQUEST,
});

export function createTokenRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.getAsync('/ft/metadata', async (req, res) => {
    const limit = parseTokenQueryLimit(req.query.limit ?? 96);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);

    const { results, total } = await db.getFtMetadataList({ offset, limit });

    res.status(200).json({ limit, offset, total, results });
  });

  router.getAsync('/nft/metadata', async (req, res) => {
    const limit = parseTokenQueryLimit(req.query.limit ?? 96);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);

    const { results, total } = await db.getNftMetadataList({ offset, limit });

    res.status(200).json({ limit, offset, total, results });
  });

  //router for fungible tokens
  router.getAsync('/:contractId/ft/metadata', async (req, res) => {
    const { contractId } = req.params;

    const metadata = await db.getFtMetadata(contractId);
    if (!metadata.found) {
      res.status(404).json({ error: 'tokens not found' });
      return;
    }

    const {
      token_uri,
      name,
      description,
      image_uri,
      image_canonical_uri,
      symbol,
      decimals,
    } = metadata.result;

    const response: FungibleTokenMetadataResponse = {
      token_uri: token_uri,
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
  router.getAsync('/:contractId/nft/metadata', async (req, res) => {
    const { contractId } = req.params;
    const metadata = await db.getNftMetadata(contractId);

    if (!metadata.found) {
      res.status(404).json({ error: 'tokens not found' });
      return;
    }
    const { token_uri, name, description, image_uri, image_canonical_uri } = metadata.result;

    const response: NonFungibleTokenMetadataResponse = {
      token_uri: token_uri,
      name: name,
      description: description,
      image_uri: image_uri,
      image_canonical_uri: image_canonical_uri,
    };
    res.status(200).json(response);
  });

  return router;
}
