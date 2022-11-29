import { asyncHandler } from '../../async-handler';
import * as express from 'express';
import {
  FungibleTokenMetadata,
  FungibleTokensMetadataList,
  NonFungibleTokenHistoryEvent,
  NonFungibleTokenHistoryEventList,
  NonFungibleTokenHolding,
  NonFungibleTokenHoldingsList,
  NonFungibleTokenMetadata,
  NonFungibleTokenMint,
  NonFungibleTokenMintList,
  NonFungibleTokensMetadataList,
} from '@stacks/stacks-blockchain-api-types';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from './../../pagination';
import { isFtMetadataEnabled, isNftMetadataEnabled } from '../../../token-metadata/helpers';
import { has0xPrefix, isValidPrincipal } from '../../../helpers';
import { booleanValueForParam, isUnanchoredRequest } from '../../../api/query-helpers';
import { decodeClarityValueToRepr } from 'stacks-encoding-native-js';
import { getAssetEventTypeString, parseDbTx } from '../../controllers/db-controller';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { PgStore } from '../../../datastore/pg-store';

export function createTokenRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  router.use(express.json());

  router.get(
    '/nft/holdings',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const principal = req.query.principal;
      if (typeof principal !== 'string' || !isValidPrincipal(principal)) {
        res.status(400).json({ error: `Invalid or missing principal` });
        return;
      }
      let assetIdentifiers: string[] | undefined;
      if (req.query.asset_identifiers !== undefined) {
        for (const assetIdentifier of [req.query.asset_identifiers].flat()) {
          if (
            typeof assetIdentifier !== 'string' ||
            !isValidPrincipal(assetIdentifier.split('::')[0])
          ) {
            res.status(400).json({ error: `Invalid asset identifier ${assetIdentifier}` });
            return;
          } else {
            if (!assetIdentifiers) {
              assetIdentifiers = [];
            }
            assetIdentifiers?.push(assetIdentifier);
          }
        }
      }
      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const includeTxMetadata = booleanValueForParam(req, res, next, 'tx_metadata');

      const { results, total } = await db.getNftHoldings({
        principal: principal,
        assetIdentifiers: assetIdentifiers,
        offset: offset,
        limit: limit,
        includeUnanchored: includeUnanchored,
        includeTxMetadata: includeTxMetadata,
      });
      const parsedResults: NonFungibleTokenHolding[] = results.map(result => {
        const parsedClarityValue = decodeClarityValueToRepr(result.nft_holding_info.value);
        const parsedNftData = {
          asset_identifier: result.nft_holding_info.asset_identifier,
          value: {
            hex: result.nft_holding_info.value,
            repr: parsedClarityValue,
          },
          block_height: result.nft_holding_info.block_height,
        };
        if (includeTxMetadata && result.tx) {
          return { ...parsedNftData, tx: parseDbTx(result.tx) };
        }
        return { ...parsedNftData, tx_id: result.nft_holding_info.tx_id };
      });

      const response: NonFungibleTokenHoldingsList = {
        limit: limit,
        offset: offset,
        total: total,
        results: parsedResults,
      };
      setETagCacheHeaders(res);
      res.status(200).json(response);
    })
  );

  router.get(
    '/nft/history',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const assetIdentifier = req.query.asset_identifier;
      if (
        typeof assetIdentifier !== 'string' ||
        !isValidPrincipal(assetIdentifier.split('::')[0])
      ) {
        res.status(400).json({ error: `Invalid or missing asset_identifier` });
        return;
      }
      let value = req.query.value;
      if (typeof value !== 'string') {
        res.status(400).json({ error: `Invalid or missing value` });
        return;
      }
      if (!has0xPrefix(value)) {
        value = `0x${value}`;
      }
      const strValue = value;
      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const includeTxMetadata = booleanValueForParam(req, res, next, 'tx_metadata');

      await db
        .sqlTransaction(async sql => {
          const chainTip = await db.getCurrentBlockHeight();
          if (!chainTip.found) {
            throw { error: `Unable to find a valid block to query` };
          }
          const { results, total } = await db.getNftHistory({
            assetIdentifier: assetIdentifier,
            value: strValue,
            limit: limit,
            offset: offset,
            blockHeight: includeUnanchored ? chainTip.result + 1 : chainTip.result,
            includeTxMetadata: includeTxMetadata,
          });
          const parsedResults: NonFungibleTokenHistoryEvent[] = results.map(result => {
            const parsedNftData = {
              sender: result.nft_event.sender,
              recipient: result.nft_event.recipient,
              event_index: result.nft_event.event_index,
              asset_event_type: getAssetEventTypeString(result.nft_event.asset_event_type_id),
            };
            if (includeTxMetadata && result.tx) {
              return { ...parsedNftData, tx: parseDbTx(result.tx) };
            }
            return { ...parsedNftData, tx_id: result.nft_event.tx_id };
          });
          const response: NonFungibleTokenHistoryEventList = {
            limit: limit,
            offset: offset,
            total: total,
            results: parsedResults,
          };
          return response;
        })
        .then(response => {
          setETagCacheHeaders(res);
          res.status(200).json(response);
        })
        .catch(error => {
          res.status(400).json(error);
        });
    })
  );

  router.get(
    '/nft/mints',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const assetIdentifier = req.query.asset_identifier;
      if (
        typeof assetIdentifier !== 'string' ||
        !isValidPrincipal(assetIdentifier.split('::')[0])
      ) {
        res.status(400).json({ error: `Invalid or missing asset_identifier` });
        return;
      }
      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const includeTxMetadata = booleanValueForParam(req, res, next, 'tx_metadata');

      await db
        .sqlTransaction(async sql => {
          const chainTip = await db.getCurrentBlockHeight();
          if (!chainTip.found) {
            throw { error: `Unable to find a valid block to query` };
          }
          const { results, total } = await db.getNftMints({
            assetIdentifier: assetIdentifier,
            limit: limit,
            offset: offset,
            blockHeight: includeUnanchored ? chainTip.result + 1 : chainTip.result,
            includeTxMetadata: includeTxMetadata,
          });
          const parsedResults: NonFungibleTokenMint[] = results.map(result => {
            const parsedClarityValue = decodeClarityValueToRepr(result.nft_event.value);
            const parsedNftData = {
              recipient: result.nft_event.recipient,
              event_index: result.nft_event.event_index,
              value: {
                hex: result.nft_event.value,
                repr: parsedClarityValue,
              },
            };
            if (includeTxMetadata && result.tx) {
              return { ...parsedNftData, tx: parseDbTx(result.tx) };
            }
            return { ...parsedNftData, tx_id: result.nft_event.tx_id };
          });
          const response: NonFungibleTokenMintList = {
            limit: limit,
            offset: offset,
            total: total,
            results: parsedResults,
          };
          return response;
        })
        .then(response => {
          setETagCacheHeaders(res);
          res.status(200).json(response);
        })
        .catch(error => {
          res.status(400).json(error);
        });
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

      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
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

      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
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
