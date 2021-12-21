import { asyncHandler } from '../../async-handler';
import * as express from 'express';
import { DataStore } from '../../../datastore/common';
import {
  FungibleTokenMetadata,
  FungibleTokensMetadataList,
  NonFungibleTokenHolding,
  NonFungibleTokenHoldingsList,
  NonFungibleTokenMetadata,
  NonFungibleTokensMetadataList,
} from '@stacks/stacks-blockchain-api-types';
import { parseLimitQuery, parsePagingQueryInput } from './../../pagination';
import {
  isFtMetadataEnabled,
  isNftMetadataEnabled,
} from '../../../event-stream/tokens-contract-handler';
import { bufferToHexPrefixString, isValidPrincipal } from '../../../helpers';
import { booleanValueForParam, isUnanchoredRequest } from '../../../api/query-helpers';
import { cvToString, deserializeCV } from '@stacks/transactions';
import { getTxFromDataStore } from 'src/api/controllers/db-controller';

const MAX_TOKENS_PER_REQUEST = 200;
const parseTokenQueryLimit = parseLimitQuery({
  maxItems: MAX_TOKENS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TOKENS_PER_REQUEST,
});

export function createTokenRouter(db: DataStore): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.get(
    '/nft/holdings',
    asyncHandler(async (req, res, next) => {
      const principal = req.query.principal;
      if (typeof principal !== 'string' || !isValidPrincipal(principal)) {
        res.status(400).json({ error: `Invalid or missing principal` });
        return;
      }
      const assetIdentifier = req.query.asset_identifier;
      if (
        assetIdentifier !== undefined &&
        (typeof assetIdentifier !== 'string' || !isValidPrincipal(assetIdentifier.split('::')[0]))
      ) {
        res.status(400).json({ error: `Invalid asset_identifier` });
        return;
      }
      const limit = parseTokenQueryLimit(req.query.limit ?? 50);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const includeTxMetadata = booleanValueForParam(req, res, next, 'tx_metadata');

      const { results, total } = await db.getNftHoldings({
        principal: principal,
        assetIdentifier: assetIdentifier,
        offset: offset,
        limit: limit,
        includeUnanchored: includeUnanchored,
      });
      const parsedResults: NonFungibleTokenHolding[] = await Promise.all(
        results.map(async result => {
          const txId = bufferToHexPrefixString(result.tx_id);
          const parsedNftData = {
            asset_identifier: result.asset_identifier,
            value: {
              hex: bufferToHexPrefixString(result.value),
              repr: cvToString(deserializeCV(result.value)),
            },
          };
          if (includeTxMetadata) {
            const tx = await getTxFromDataStore(db, {
              txId: txId,
              includeUnanchored: includeUnanchored,
            });
            if (tx.found) {
              return { ...parsedNftData, tx: tx.result };
            }
          }
          return { ...parsedNftData, tx_id: txId };
        })
      );

      const response: NonFungibleTokenHoldingsList = {
        limit: limit,
        offset: offset,
        total: total,
        results: parsedResults,
      };
      res.status(200).json(response);
    })
  );

  router.get(
    '/ft/metadata',
    asyncHandler(async (req, res) => {
      if (!isFtMetadataEnabled()) {
        res.status(500).json({
          error: 'FT metadata processing is not enabled on this server',
        });
        return;
      }

      const limit = parseTokenQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const { results, total } = await db.getFtMetadataList({ offset, limit });

      const response: FungibleTokensMetadataList = {
        limit: limit,
        offset: offset,
        total: total,
        results: results,
      };

      res.status(200).json(response);
    })
  );

  router.get(
    '/nft/metadata',
    asyncHandler(async (req, res) => {
      if (!isNftMetadataEnabled()) {
        res.status(500).json({
          error: 'NFT metadata processing is not enabled on this server',
        });
        return;
      }

      const limit = parseTokenQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const { results, total } = await db.getNftMetadataList({ offset, limit });

      const response: NonFungibleTokensMetadataList = {
        limit: limit,
        offset: offset,
        total: total,
        results: results,
      };

      res.status(200).json(response);
    })
  );

  router.get(
    '/:contractId/ft/metadata',
    asyncHandler(async (req, res) => {
      if (!isFtMetadataEnabled()) {
        res.status(500).json({
          error: 'FT metadata processing is not enabled on this server',
        });
        return;
      }

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
        tx_id,
        sender_address,
      } = metadata.result;

      const response: FungibleTokenMetadata = {
        token_uri: token_uri,
        name: name,
        description: description,
        image_uri: image_uri,
        image_canonical_uri: image_canonical_uri,
        symbol: symbol,
        decimals: decimals,
        tx_id: tx_id,
        sender_address: sender_address,
      };
      res.status(200).json(response);
    })
  );

  router.get(
    '/:contractId/nft/metadata',
    asyncHandler(async (req, res) => {
      if (!isNftMetadataEnabled()) {
        res.status(500).json({
          error: 'NFT metadata processing is not enabled on this server',
        });
        return;
      }

      const { contractId } = req.params;
      const metadata = await db.getNftMetadata(contractId);

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
        tx_id,
        sender_address,
      } = metadata.result;

      const response: NonFungibleTokenMetadata = {
        token_uri: token_uri,
        name: name,
        description: description,
        image_uri: image_uri,
        image_canonical_uri: image_canonical_uri,
        tx_id: tx_id,
        sender_address: sender_address,
      };
      res.status(200).json(response);
    })
  );

  return router;
}
