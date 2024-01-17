import { asyncHandler } from '../async-handler';
import * as express from 'express';
import {
  NonFungibleTokenHistoryEvent,
  NonFungibleTokenHistoryEventList,
  NonFungibleTokenHolding,
  NonFungibleTokenHoldingsList,
  NonFungibleTokenMint,
  NonFungibleTokenMintList,
} from '@stacks/stacks-blockchain-api-types';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { isValidPrincipal } from '../../helpers';
import { booleanValueForParam, isUnanchoredRequest } from '../query-helpers';
import { decodeClarityValueToRepr } from 'stacks-encoding-native-js';
import { getAssetEventTypeString, parseDbTx } from '../controllers/db-controller';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';
import { PgStore } from '../../datastore/pg-store';
import { has0xPrefix } from '@hirosystems/api-toolkit';

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
        if (typeof req.query.asset_identifiers === 'string') {
          if (req.query.asset_identifiers.includes(',')) {
            assetIdentifiers = req.query.asset_identifiers.split(',');
          } else {
            assetIdentifiers = [req.query.asset_identifiers];
          }
        } else {
          assetIdentifiers = req.query.asset_identifiers as string[];
        }
        for (const assetIdentifier of assetIdentifiers) {
          if (
            typeof assetIdentifier !== 'string' ||
            !isValidPrincipal(assetIdentifier.split('::')[0])
          ) {
            res.status(400).json({ error: `Invalid asset identifier ${assetIdentifier}` });
            return;
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

  return router;
}
