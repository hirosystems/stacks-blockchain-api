import { asyncHandler } from '../async-handler';
import * as express from 'express';
import {
  FungibleTokenHolderList,
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
import {
  getETagCacheHandler,
  handleChainTipCache,
  setETagCacheHeaders,
} from '../controllers/cache-controller';
import { PgStore } from '../../datastore/pg-store';
import { has0xPrefix } from '@hirosystems/api-toolkit';

import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam, UnanchoredParamSchema } from '../schemas/params';
import { PaginatedResponse } from '../schemas/util';
import { TransactionSchema } from '../schemas/entities/transactions';
import {
  NonFungibleTokenHistoryEventWithTxIdSchema,
  NonFungibleTokenHistoryEventWithTxMetadataSchema,
  NonFungibleTokenHoldingWithTxIdSchema,
  NonFungibleTokenHoldingWithTxMetadataSchema,
  NonFungibleTokenMintWithTxIdSchema,
  NonFungibleTokenMintWithTxMetadataSchema,
} from '../schemas/entities/tokens';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';

export const TokenRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/nft/holdings',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_nft_holdings',
        summary: 'Non-Fungible Token holdings',
        description: `Retrieves the list of Non-Fungible Tokens owned by the given principal (STX address or Smart Contract ID).
        Results can be filtered by one or more asset identifiers and can include metadata about the transaction that made the principal own each token.

        More information on Non-Fungible Tokens on the Stacks blockchain can be found [here](https://docs.stacks.co/write-smart-contracts/tokens#non-fungible-tokens-nfts).`,
        tags: ['Non-Fungible Tokens'],
        querystring: Type.Object({
          principal: Type.String({
            description: `token owner's STX address or Smart Contract ID`,
            examples: ['SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v3'],
          }),
          asset_identifiers: Type.Optional(
            Type.Array(
              Type.String({
                description: 'identifiers of the token asset classes to filter for',
                examples: ['SPQZF23W7SEYBFG5JQ496NMY0G7379SRYEDREMSV.Candy::candy'],
              })
            )
          ),
          limit: LimitParam(ResourceType.Token, 'Limit', 'max number of tokens to fetch'),
          offset: OffsetParam('Offset', 'index of first tokens to fetch'),
          unanchored: UnanchoredParamSchema,
          tx_metadata: Type.Boolean({
            default: false,
            description:
              'whether or not to include the complete transaction metadata instead of just `tx_id`. Enabling this option can affect performance and response times.',
          }),
        }),
        response: {
          200: PaginatedResponse(
            Type.Union(
              [NonFungibleTokenHoldingWithTxIdSchema, NonFungibleTokenHoldingWithTxMetadataSchema],
              {
                title: 'NonFungibleTokenHoldingsList',
                description: 'List of Non-Fungible Token holdings',
              }
            ),
            {
              description: 'List of Non-Fungible Token holdings',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const principal = req.query.principal;
      if (typeof principal !== 'string' || !isValidPrincipal(principal)) {
        throw new InvalidRequestError(
          `Invalid or missing principal`,
          InvalidRequestErrorType.invalid_query
        );
      }
      let assetIdentifiers: string[] | undefined;
      if (req.query.asset_identifiers) {
        assetIdentifiers = req.query.asset_identifiers.flatMap(str => str.split(',') as string[]);
        for (const assetIdentifier of assetIdentifiers) {
          if (!isValidPrincipal(assetIdentifier.split('::')[0])) {
            throw new InvalidRequestError(
              `Invalid asset identifier`,
              InvalidRequestErrorType.invalid_query
            );
          }
        }
      }

      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = req.query.unanchored ?? false;
      const includeTxMetadata = req.query.tx_metadata ?? false;

      const { results, total } = await fastify.db.getNftHoldings({
        principal: principal,
        assetIdentifiers: assetIdentifiers,
        offset: offset,
        limit: limit,
        includeUnanchored: includeUnanchored,
        includeTxMetadata: includeTxMetadata,
      });
      const parsedResults = results.map(result => {
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
          return {
            ...parsedNftData,
            tx: parseDbTx(result.tx),
          };
        }
        return { ...parsedNftData, tx_id: result.nft_holding_info.tx_id };
      });

      const response = {
        limit: limit,
        offset: offset,
        total: total,
        results: parsedResults,
      };
      await reply.send(response);
    }
  );

  fastify.get(
    '/nft/history',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_nft_history',
        summary: 'Non-Fungible Token history',
        description: `Retrieves all events relevant to a Non-Fungible Token. Useful to determine the ownership history of a particular asset.

        More information on Non-Fungible Tokens on the Stacks blockchain can be found [here](https://docs.stacks.co/write-smart-contracts/tokens#non-fungible-tokens-nfts).`,
        tags: ['Non-Fungible Tokens'],
        querystring: Type.Object({
          asset_identifier: Type.String({
            description: 'asset class identifier',
            examples: [
              'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.the-explorer-guild::The-Explorer-Guild',
            ],
          }),
          value: Type.String({
            description: `hex representation of the token's unique value`,
            examples: ['0x0100000000000000000000000000000803'],
          }),
          limit: LimitParam(ResourceType.Token, 'Limit', 'max number of events to fetch'),
          offset: OffsetParam('Offset', 'index of first event to fetch'),
          unachored: UnanchoredParamSchema,
          tx_metadata: Type.Boolean({
            default: false,
            description:
              'whether or not to include the complete transaction metadata instead of just `tx_id`. Enabling this option can affect performance and response times.',
          }),
        }),
        response: {
          200: PaginatedResponse(
            Type.Union(
              [
                NonFungibleTokenHistoryEventWithTxIdSchema,
                NonFungibleTokenHistoryEventWithTxMetadataSchema,
              ],
              {
                title: 'NonFungibleTokenHistoryEvent',
                description: 'Describes an event from the history of a Non-Fungible Token',
              }
            ),
            {
              description: 'List of Non-Fungible Token history events',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const assetIdentifier = req.query.asset_identifier;
      if (!isValidPrincipal(assetIdentifier.split('::')[0])) {
        throw new InvalidRequestError(
          `Invalid or missing asset_identifier`,
          InvalidRequestErrorType.invalid_query
        );
      }
      let value = req.query.value;
      if (!has0xPrefix(value)) {
        value = `0x${value}`;
      }
      const strValue = value;

      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = req.query.unachored ?? false;
      const includeTxMetadata = req.query.tx_metadata ?? false;

      await fastify.db
        .sqlTransaction(async sql => {
          const chainTip = await fastify.db.getCurrentBlockHeight();
          if (!chainTip.found) {
            throw { error: `Unable to find a valid block to query` };
          }
          const { results, total } = await fastify.db.getNftHistory({
            assetIdentifier: assetIdentifier,
            value: strValue,
            limit: limit,
            offset: offset,
            blockHeight: includeUnanchored ? chainTip.result + 1 : chainTip.result,
            includeTxMetadata: includeTxMetadata,
          });
          const parsedResults = results.map(result => {
            const parsedNftData = {
              sender: result.nft_event.sender,
              recipient: result.nft_event.recipient,
              event_index: result.nft_event.event_index,
              asset_event_type: getAssetEventTypeString(result.nft_event.asset_event_type_id),
            };
            if (includeTxMetadata && result.tx) {
              return {
                ...parsedNftData,
                tx: parseDbTx(result.tx),
              };
            }
            return { ...parsedNftData, tx_id: result.nft_event.tx_id };
          });
          const response = {
            limit: limit,
            offset: offset,
            total: total,
            results: parsedResults,
          };
          return response;
        })
        .then(async response => {
          await reply.send(response);
        })
        .catch(error => {
          throw new InvalidRequestError(error.toString(), InvalidRequestErrorType.bad_request);
        });
    }
  );

  fastify.get(
    '/nft/mints',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_nft_mints',
        summary: 'Non-Fungible Token mints',
        description: `Retrieves all mint events for a Non-Fungible Token asset class. Useful to determine which NFTs of a particular collection have been claimed.

        More information on Non-Fungible Tokens on the Stacks blockchain can be found [here](https://docs.stacks.co/write-smart-contracts/tokens#non-fungible-tokens-nfts).`,
        tags: ['Non-Fungible Tokens'],
        querystring: Type.Object({
          asset_identifier: Type.String({
            description: 'asset class identifier',
            examples: [
              'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.the-explorer-guild::The-Explorer-Guild',
            ],
          }),
          limit: LimitParam(ResourceType.Token, 'Limit', 'max number of events to fetch'),
          offset: OffsetParam('Offset', 'index of first event to fetch'),
          unachored: UnanchoredParamSchema,
          tx_metadata: Type.Boolean({
            default: false,
            description:
              'whether or not to include the complete transaction metadata instead of just `tx_id`. Enabling this option can affect performance and response times.',
          }),
        }),
        response: {
          200: PaginatedResponse(
            Type.Union(
              [NonFungibleTokenMintWithTxIdSchema, NonFungibleTokenMintWithTxMetadataSchema],
              {
                title: 'NonFungibleTokenMint',
                description: 'Describes the minting of a Non-Fungible Token',
              }
            ),
            {
              title: 'NonFungibleTokenMintList',
              description: 'List of Non-Fungible Token mint events for an asset identifier',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const assetIdentifier = req.query.asset_identifier;
      if (!isValidPrincipal(assetIdentifier.split('::')[0])) {
        throw new InvalidRequestError(
          `Invalid or missing asset_identifier`,
          InvalidRequestErrorType.invalid_query
        );
      }

      const limit = getPagingQueryLimit(ResourceType.Token, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = req.query.unachored ?? false;
      const includeTxMetadata = req.query.tx_metadata ?? false;

      await fastify.db
        .sqlTransaction(async sql => {
          const chainTip = await fastify.db.getCurrentBlockHeight();
          if (!chainTip.found) {
            throw { error: `Unable to find a valid block to query` };
          }
          const { results, total } = await fastify.db.getNftMints({
            assetIdentifier: assetIdentifier,
            limit: limit,
            offset: offset,
            blockHeight: includeUnanchored ? chainTip.result + 1 : chainTip.result,
            includeTxMetadata: includeTxMetadata,
          });
          const parsedResults = results.map(result => {
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
              return {
                ...parsedNftData,
                tx: parseDbTx(result.tx),
              };
            }
            return { ...parsedNftData, tx_id: result.nft_event.tx_id };
          });
          const response = {
            limit: limit,
            offset: offset,
            total: total,
            results: parsedResults,
          };
          return response;
        })
        .then(async response => {
          await reply.send(response);
        })
        .catch(error => {
          throw new InvalidRequestError(error.toString(), InvalidRequestErrorType.bad_request);
        });
    }
  );

  await Promise.resolve();
};

export function createTokenRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  router.use(express.json());

  router.get(
    '/ft/:token/holders',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const token = req.params.token;
      const limit = getPagingQueryLimit(ResourceType.TokenHolders, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { results, total, totalSupply } = await db.getTokenHolders({ token, limit, offset });
      const response: FungibleTokenHolderList = {
        limit: limit,
        offset: offset,
        total: total,
        total_supply: totalSupply,
        results: results,
      };
      setETagCacheHeaders(res);
      res.status(200).json(response);
    })
  );

  return router;
}
