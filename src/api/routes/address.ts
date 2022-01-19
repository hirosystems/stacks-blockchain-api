import * as express from 'express';
import { asyncHandler } from '../async-handler';
import * as Bluebird from 'bluebird';
import { BlockIdentifier, DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { isUnanchoredRequest, getBlockParams, parseUntilBlockQuery } from '../query-helpers';
import {
  bufferToHexPrefixString,
  formatMapToObject,
  getSendManyContract,
  has0xPrefix,
  isProdEnv,
  isValidC32Address,
  isValidPrincipal,
  logger,
} from '../../helpers';
import {
  getTxFromDataStore,
  parseDbEvent,
  parseDbMempoolTx,
  parseDbTx,
} from '../controllers/db-controller';
import {
  TransactionResults,
  TransactionEvent,
  AddressBalanceResponse,
  AddressStxBalanceResponse,
  AddressStxInboundListResponse,
  InboundStxTransfer,
  AddressNftListResponse,
  MempoolTransactionListResponse,
  AddressTransactionWithTransfers,
  AddressTransactionsWithTransfersListResponse,
  AddressNonces,
} from '@stacks/stacks-blockchain-api-types';
import { ChainID, cvToString, deserializeCV } from '@stacks/transactions';
import { validate } from '../validate';
import { NextFunction, Request, Response } from 'express';
import { getChainTipCacheHandler, setChainTipCacheHeaders } from '../controllers/cache-controller';

const MAX_TX_PER_REQUEST = 50;
const MAX_ASSETS_PER_REQUEST = 50;
const MAX_STX_INBOUND_PER_REQUEST = 500;

const parseTxQueryLimit = parseLimitQuery({
  maxItems: MAX_TX_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TX_PER_REQUEST,
});

const parseAssetsQueryLimit = parseLimitQuery({
  maxItems: MAX_ASSETS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_ASSETS_PER_REQUEST,
});

const parseStxInboundLimit = parseLimitQuery({
  maxItems: MAX_STX_INBOUND_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_STX_INBOUND_PER_REQUEST,
});

async function getBlockHeight(
  untilBlock: number | string | undefined,
  req: Request,
  res: Response,
  next: NextFunction,
  db: DataStore
): Promise<number> {
  let blockHeight = 0;
  if (typeof untilBlock === 'number') {
    blockHeight = untilBlock;
  } else if (typeof untilBlock === 'string') {
    const block = await db.getBlock({ hash: untilBlock });
    if (!block.found) {
      const error = `block not found with hash ${untilBlock}`;
      res.status(404).json({ error: error });
      next(error);
      throw new Error(error);
    }
    blockHeight = block.result.block_height;
  } else {
    const includeUnanchored = isUnanchoredRequest(req, res, next);
    const currentBlockHeight = await db.getCurrentBlockHeight();
    if (!currentBlockHeight.found) {
      const error = `no current block`;
      res.status(404).json({ error: error });
      next(error);
      throw new Error(error);
    }

    blockHeight = currentBlockHeight.result + (includeUnanchored ? 1 : 0);
  }

  return blockHeight;
}

interface AddressAssetEvents {
  results: TransactionEvent[];
  limit: number;
  offset: number;
  total: number;
}

export function createAddressRouter(db: DataStore, chainId: ChainID): express.Router {
  const router = express.Router();
  const cacheHandler = getChainTipCacheHandler(db);

  router.get(
    '/:stx_address/stx',
    asyncHandler(async (req, res, next) => {
      const stxAddress = req.params['stx_address'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }
      const untilBlock = parseUntilBlockQuery(req, res, next);

      const blockHeight = await getBlockHeight(untilBlock, req, res, next, db);

      // Get balance info for STX token
      const stxBalanceResult = await db.getStxBalanceAtBlock(stxAddress, blockHeight);
      const tokenOfferingLocked = await db.getTokenOfferingLocked(stxAddress, blockHeight);
      const result: AddressStxBalanceResponse = {
        balance: stxBalanceResult.balance.toString(),
        total_sent: stxBalanceResult.totalSent.toString(),
        total_received: stxBalanceResult.totalReceived.toString(),
        total_fees_sent: stxBalanceResult.totalFeesSent.toString(),
        total_miner_rewards_received: stxBalanceResult.totalMinerRewardsReceived.toString(),
        lock_tx_id: stxBalanceResult.lockTxId,
        locked: stxBalanceResult.locked.toString(),
        lock_height: stxBalanceResult.lockHeight,
        burnchain_lock_height: stxBalanceResult.burnchainLockHeight,
        burnchain_unlock_height: stxBalanceResult.burnchainUnlockHeight,
      };

      if (tokenOfferingLocked.found) {
        result.token_offering_locked = tokenOfferingLocked.result;
      }
      res.json(result);
    })
  );

  // get balances for STX, FTs, and counts for NFTs
  router.get(
    '/:stx_address/balances',
    asyncHandler(async (req, res, next) => {
      const stxAddress = req.params['stx_address'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }

      const untilBlock = parseUntilBlockQuery(req, res, next);
      const blockHeight = await getBlockHeight(untilBlock, req, res, next, db);

      // Get balance info for STX token
      const stxBalanceResult = await db.getStxBalanceAtBlock(stxAddress, blockHeight);
      const tokenOfferingLocked = await db.getTokenOfferingLocked(stxAddress, blockHeight);

      // Get balances for fungible tokens
      const ftBalancesResult = await db.getFungibleTokenBalances({
        stxAddress,
        untilBlock: blockHeight,
      });
      const ftBalances = formatMapToObject(ftBalancesResult, val => {
        return {
          balance: val.balance.toString(),
          total_sent: val.totalSent.toString(),
          total_received: val.totalReceived.toString(),
        };
      });

      // Get counts for non-fungible tokens
      const nftBalancesResult = await db.getNonFungibleTokenCounts({
        stxAddress,
        untilBlock: blockHeight,
      });
      const nftBalances = formatMapToObject(nftBalancesResult, val => {
        return {
          count: val.count.toString(),
          total_sent: val.totalSent.toString(),
          total_received: val.totalReceived.toString(),
        };
      });

      const result: AddressBalanceResponse = {
        stx: {
          balance: stxBalanceResult.balance.toString(),
          total_sent: stxBalanceResult.totalSent.toString(),
          total_received: stxBalanceResult.totalReceived.toString(),
          total_fees_sent: stxBalanceResult.totalFeesSent.toString(),
          total_miner_rewards_received: stxBalanceResult.totalMinerRewardsReceived.toString(),
          lock_tx_id: stxBalanceResult.lockTxId,
          locked: stxBalanceResult.locked.toString(),
          lock_height: stxBalanceResult.lockHeight,
          burnchain_lock_height: stxBalanceResult.burnchainLockHeight,
          burnchain_unlock_height: stxBalanceResult.burnchainUnlockHeight,
        },
        fungible_tokens: ftBalances,
        non_fungible_tokens: nftBalances,
      };

      if (tokenOfferingLocked.found) {
        result.token_offering_locked = tokenOfferingLocked.result;
      }

      res.json(result);
    })
  );

  /**
   * Get recent STX transactions associated with a principal (stx address or contract id,
   * sender or receiver).
   */
  router.get(
    '/:principal/transactions',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const principal = req.params['principal'];
      if (!isValidPrincipal(principal)) {
        res.status(400).json({ error: `invalid principal "${principal}"` });
        return;
      }
      const untilBlock = parseUntilBlockQuery(req, res, next);
      const blockParams = getBlockParams(req, res, next);
      let atSingleBlock = false;
      let blockHeight = 0;
      if (blockParams.blockHeight) {
        if (untilBlock) {
          res
            .status(400)
            .json({ error: `can't handle until_block and block_height in the same request` });
          return;
        }
        atSingleBlock = true;
        blockHeight = blockParams.blockHeight;
      } else {
        blockHeight = await getBlockHeight(untilBlock, req, res, next, db);
      }
      const limit = parseTxQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const { results: txResults, total } = await db.getAddressTxs({
        stxAddress: principal,
        limit,
        offset,
        blockHeight,
        atSingleBlock,
      });
      const results = txResults.map(dbTx => parseDbTx(dbTx));
      const response: TransactionResults = { limit, offset, total, results };
      setChainTipCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/:stx_address/:tx_id/with_transfers',
    asyncHandler(async (req, res) => {
      const stxAddress = req.params['stx_address'];
      let tx_id = req.params['tx_id'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }
      if (!has0xPrefix(tx_id)) {
        tx_id = '0x' + tx_id;
      }
      const results = await db.getInformationTxsWithStxTransfers({ stxAddress, tx_id });
      if (results && results.tx) {
        const txQuery = await getTxFromDataStore(db, {
          txId: results.tx.tx_id,
          dbTx: results.tx,
          includeUnanchored: false,
        });
        if (!txQuery.found) {
          throw new Error('unexpected tx not found -- fix tx enumeration query');
        }
        const result: AddressTransactionWithTransfers = {
          tx: txQuery.result,
          stx_sent: results.stx_sent.toString(),
          stx_received: results.stx_received.toString(),
          stx_transfers: results.stx_transfers.map(transfer => ({
            amount: transfer.amount.toString(),
            sender: transfer.sender,
            recipient: transfer.recipient,
          })),
        };
        res.json(result);
      } else res.status(404).json({ error: 'No matching transaction found' });
    })
  );

  router.get(
    '/:stx_address/transactions_with_transfers',
    asyncHandler(async (req, res, next) => {
      const stxAddress = req.params['stx_address'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }

      const untilBlock = parseUntilBlockQuery(req, res, next);
      const blockParams = getBlockParams(req, res, next);
      let atSingleBlock = false;
      let blockHeight = 0;
      if (blockParams.blockHeight) {
        if (untilBlock) {
          res
            .status(400)
            .json({ error: `can't handle until_block and block_height in the same request` });
          return;
        }
        atSingleBlock = true;
        blockHeight = blockParams.blockHeight;
      } else {
        blockHeight = await getBlockHeight(untilBlock, req, res, next, db);
      }
      const limit = parseTxQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { results: txResults, total } = await db.getAddressTxsWithAssetTransfers({
        stxAddress: stxAddress,
        limit,
        offset,
        blockHeight,
        atSingleBlock,
      });

      // TODO: use getBlockWithMetadata or similar to avoid transaction integrity issues from lazy resolving block tx data (primarily the contract-call ABI data)
      const results = await Bluebird.mapSeries(txResults, async entry => {
        const txQuery = await getTxFromDataStore(db, {
          txId: entry.tx.tx_id,
          dbTx: entry.tx,
          includeUnanchored: blockParams.includeUnanchored ?? false,
        });
        if (!txQuery.found) {
          throw new Error('unexpected tx not found -- fix tx enumeration query');
        }
        const result: AddressTransactionWithTransfers = {
          tx: txQuery.result,
          stx_sent: entry.stx_sent.toString(),
          stx_received: entry.stx_received.toString(),
          stx_transfers: entry.stx_transfers.map(transfer => ({
            amount: transfer.amount.toString(),
            sender: transfer.sender,
            recipient: transfer.recipient,
          })),
          ft_transfers: entry.ft_transfers.map(transfer => ({
            asset_identifier: transfer.asset_identifier,
            amount: transfer.amount.toString(),
            sender: transfer.sender,
            recipient: transfer.recipient,
          })),
          nft_transfers: entry.nft_transfers.map(transfer => {
            const valueHex = bufferToHexPrefixString(transfer.value);
            const valueRepr = cvToString(deserializeCV(transfer.value));
            const nftTransfer = {
              asset_identifier: transfer.asset_identifier,
              value: {
                hex: valueHex,
                repr: valueRepr,
              },
              sender: transfer.sender,
              recipient: transfer.recipient,
            };
            return nftTransfer;
          }),
        };
        return result;
      });

      const response: AddressTransactionsWithTransfersListResponse = {
        limit,
        offset,
        total,
        results,
      };
      res.json(response);
    })
  );

  router.get(
    '/:stx_address/assets',
    asyncHandler(async (req, res, next) => {
      // get recent asset event associated with address
      const stxAddress = req.params['stx_address'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }
      const untilBlock = parseUntilBlockQuery(req, res, next);
      const blockHeight = await getBlockHeight(untilBlock, req, res, next, db);

      const limit = parseAssetsQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { results: assetEvents, total } = await db.getAddressAssetEvents({
        stxAddress,
        limit,
        offset,
        blockHeight,
      });
      const results = assetEvents.map(event => parseDbEvent(event));
      const response: AddressAssetEvents = { limit, offset, total, results };
      res.json(response);
    })
  );

  router.get(
    '/:stx_address/stx_inbound',
    asyncHandler(async (req, res, next) => {
      // get recent inbound STX transfers with memos
      const stxAddress = req.params['stx_address'];
      try {
        const sendManyContractId = getSendManyContract(chainId);
        if (!sendManyContractId || !isValidPrincipal(sendManyContractId)) {
          logger.error('Send many contract ID not properly configured');
          res.status(500).json({ error: 'Send many contract ID not properly configured' });
          return;
        }
        if (!isValidPrincipal(stxAddress)) {
          res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
          return;
        }

        let atSingleBlock = false;
        const untilBlock = parseUntilBlockQuery(req, res, next);
        const blockParams = getBlockParams(req, res, next);
        let blockHeight = 0;
        if (blockParams.blockHeight) {
          if (untilBlock) {
            res
              .status(400)
              .json({ error: `can't handle until_block and block_height in the same request` });
            return;
          }
          atSingleBlock = true;
          blockHeight = blockParams.blockHeight;
        } else {
          blockHeight = await getBlockHeight(untilBlock, req, res, next, db);
        }

        const limit = parseStxInboundLimit(req.query.limit ?? 20);
        const offset = parsePagingQueryInput(req.query.offset ?? 0);
        const { results, total } = await db.getInboundTransfers({
          stxAddress,
          limit,
          offset,
          sendManyContractId,
          blockHeight,
          atSingleBlock,
        });
        const transfers: InboundStxTransfer[] = results.map(r => ({
          sender: r.sender,
          amount: r.amount.toString(),
          memo: r.memo,
          block_height: r.block_height,
          tx_id: r.tx_id,
          transfer_type: r.transfer_type as InboundStxTransfer['transfer_type'],
          tx_index: r.tx_index,
        }));
        const response: AddressStxInboundListResponse = {
          results: transfers,
          total: total,
          limit,
          offset,
        };
        res.json(response);
      } catch (error) {
        logger.error(`Unable to get inbound transfers for ${stxAddress}`, error);
        throw error;
      }
    })
  );

  /**
   * @deprecated Use `/extended/v1/tokens/nft/holdings` instead.
   */
  router.get(
    '/:stx_address/nft_events',
    asyncHandler(async (req, res, next) => {
      // get recent asset event associated with address
      const stxAddress = req.params['stx_address'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }

      const untilBlock = parseUntilBlockQuery(req, res, next);
      const blockHeight = await getBlockHeight(untilBlock, req, res, next, db);
      const limit = parseAssetsQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);

      const response = await db.getAddressNFTEvent({
        stxAddress,
        limit,
        offset,
        blockHeight,
        includeUnanchored,
      });
      const nft_events = response.results.map(row => ({
        sender: row.sender,
        recipient: row.recipient,
        asset_identifier: row.asset_identifier,
        value: {
          hex: bufferToHexPrefixString(row.value),
          repr: cvToString(deserializeCV(row.value)),
        },
        tx_id: bufferToHexPrefixString(row.tx_id),
        block_height: row.block_height,
      }));
      const nftListResponse: AddressNftListResponse = {
        nft_events: nft_events,
        total: response.total,
        limit: limit,
        offset: offset,
      };
      res.json(nftListResponse);
    })
  );

  router.get(
    '/:address/mempool',
    asyncHandler(async (req, res, next) => {
      const limit = parseTxQueryLimit(req.query.limit ?? MAX_TX_PER_REQUEST);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const address = req.params['address'];
      if (!isValidC32Address(address)) {
        res.status(400).json({ error: `Invalid query parameter for "${address}"` });
      }

      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const { results: txResults, total } = await db.getMempoolTxList({
        offset,
        limit,
        address,
        includeUnanchored,
      });

      const results = txResults.map(tx => parseDbMempoolTx(tx));
      const response: MempoolTransactionListResponse = { limit, offset, total, results };
      if (!isProdEnv) {
        const schemaPath =
          '@stacks/stacks-blockchain-api-types/api/transaction/get-mempool-transactions.schema.json';
        await validate(schemaPath, response);
      }
      res.json(response);
    })
  );

  router.get(
    '/:stx_address/nonces',
    asyncHandler(async (req, res) => {
      // get recent asset event associated with address
      const stxAddress = req.params['stx_address'];
      if (!isValidPrincipal(stxAddress)) {
        res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
        return;
      }
      let blockIdentifier: BlockIdentifier | undefined;
      const blockHeightQuery = req.query['block_height'];
      const blockHashQuery = req.query['block_hash'];
      if (blockHeightQuery && blockHashQuery) {
        res.status(400).json({ error: `Multiple block query parameters specified` });
        return;
      }
      if (blockHeightQuery) {
        const blockHeight = Number(blockHeightQuery);
        if (!Number.isInteger(blockHeight) || blockHeight < 1) {
          res.status(400).json({
            error: `Query parameter 'block_height' is not a valid integer: ${blockHeightQuery}`,
          });
          return;
        }
        blockIdentifier = { height: blockHeight };
      } else if (blockHashQuery) {
        if (typeof blockHashQuery !== 'string' || !has0xPrefix(blockHashQuery)) {
          res.status(400).json({
            error: `Query parameter 'block_hash' is not a valid block hash hex string: ${blockHashQuery}`,
          });
          return;
        }
        blockIdentifier = { hash: blockHashQuery };
      }
      if (blockIdentifier) {
        const nonceQuery = await db.getAddressNonceAtBlock({ stxAddress, blockIdentifier });
        if (!nonceQuery.found) {
          res.status(404).json({
            error: `No block found for ${JSON.stringify(blockIdentifier)}`,
          });
          return;
        }
        const results: AddressNonces = {
          last_executed_tx_nonce: nonceQuery.result.lastExecutedTxNonce as number,
          possible_next_nonce: nonceQuery.result.possibleNextNonce,
          // Note: OpenAPI type generator doesn't support `nullable: true` so force cast it here
          last_mempool_tx_nonce: (null as unknown) as number,
          detected_missing_nonces: [],
        };
        res.json(results);
      } else {
        const nonces = await db.getAddressNonces({
          stxAddress,
        });
        const results: AddressNonces = {
          last_executed_tx_nonce: nonces.lastExecutedTxNonce as number,
          last_mempool_tx_nonce: nonces.lastMempoolTxNonce as number,
          possible_next_nonce: nonces.possibleNextNonce,
          detected_missing_nonces: nonces.detectedMissingNonces,
        };
        res.json(results);
      }
    })
  );

  return router;
}
