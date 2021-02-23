import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as Bluebird from 'bluebird';
import { DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { formatMapToObject, getSendManyContract, isValidPrincipal, logger } from '../../helpers';
import { getTxFromDataStore, parseDbEvent } from '../controllers/db-controller';
import {
  TransactionResults,
  TransactionEvent,
  AddressBalanceResponse,
  AddressStxBalanceResponse,
  AddressStxInboundListResponse,
  InboundStxTransfer,
} from '@blockstack/stacks-blockchain-api-types';
import { ChainID } from '@stacks/transactions';

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

interface AddressAssetEvents {
  results: TransactionEvent[];
  limit: number;
  offset: number;
  total: number;
}

export function createAddressRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/:stx_address/stx', async (req, res) => {
    const stxAddress = req.params['stx_address'];
    if (!isValidPrincipal(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }
    // Get balance info for STX token
    const stxBalanceResult = await db.getStxBalance(stxAddress);
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
    res.json(result);
  });

  // get balances for STX, FTs, and counts for NFTs
  router.getAsync('/:stx_address/balances', async (req, res) => {
    const stxAddress = req.params['stx_address'];
    if (!isValidPrincipal(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }
    // Get balance info for STX token
    const stxBalanceResult = await db.getStxBalance(stxAddress);

    // Get balances for fungible tokens
    const ftBalancesResult = await db.getFungibleTokenBalances(stxAddress);
    const ftBalances = formatMapToObject(ftBalancesResult, val => {
      return {
        balance: val.balance.toString(),
        total_sent: val.totalSent.toString(),
        total_received: val.totalReceived.toString(),
      };
    });

    // Get counts for non-fungible tokens
    const nftBalancesResult = await db.getNonFungibleTokenCounts(stxAddress);
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
    res.json(result);
  });

  router.getAsync('/:stx_address/transactions', async (req, res) => {
    // get recent txs associated (sender or receiver) with address
    const stxAddress = req.params['stx_address'];
    if (!isValidPrincipal(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }

    let heightFilter: number | undefined;
    if ('height' in req.query) {
      heightFilter = parseInt(req.query['height'] as string, 10);
      if (!Number.isInteger(heightFilter)) {
        return res
          .status(400)
          .json({ error: `height is not a valid integer: ${req.query['height']}` });
      }
      if (heightFilter < 1) {
        return res.status(400).json({ error: `height is not a positive integer: ${heightFilter}` });
      }
    }

    const limit = parseTxQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);
    const { results: txResults, total } = await db.getAddressTxs({
      stxAddress: stxAddress,
      height: heightFilter,
      limit,
      offset,
    });
    const results = await Bluebird.mapSeries(txResults, async tx => {
      const txQuery = await getTxFromDataStore(db, { txId: tx.tx_id });
      if (!txQuery.found) {
        throw new Error('unexpected tx not found -- fix tx enumeration query');
      }
      return txQuery.result;
    });
    const response: TransactionResults = { limit, offset, total, results };
    res.json(response);
  });

  router.getAsync('/:stx_address/assets', async (req, res) => {
    // get recent asset event associated with address
    const stxAddress = req.params['stx_address'];
    if (!isValidPrincipal(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }

    const limit = parseAssetsQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);
    const { results: assetEvents, total } = await db.getAddressAssetEvents({
      stxAddress,
      limit,
      offset,
    });
    const results = assetEvents.map(event => parseDbEvent(event));
    const response: AddressAssetEvents = { limit, offset, total, results };
    res.json(response);
  });

  router.getAsync('/:stx_address/stx_inbound', async (req, res) => {
    // get recent inbound STX transfers with memos
    const stxAddress = req.params['stx_address'];
    try {
      const sendManyContractId = getSendManyContract(chainId);
      if (!sendManyContractId || !isValidPrincipal(sendManyContractId)) {
        logger.error('Send many contract ID not properly configured');
        return res.status(500).json({ error: 'Send many contract ID not properly configured' });
      }
      if (!isValidPrincipal(stxAddress)) {
        return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
      }
      const limit = parseStxInboundLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      let heightFilter: number | undefined;
      if ('height' in req.query) {
        heightFilter = parseInt(req.query['height'] as string, 10);
        if (!Number.isInteger(heightFilter)) {
          return res
            .status(400)
            .json({ error: `height is not a valid integer: ${req.query['height']}` });
        }
        if (heightFilter < 1) {
          return res
            .status(400)
            .json({ error: `height is not a positive integer: ${heightFilter}` });
        }
      }
      const height = req.params['height'] as string | undefined;
      const { results, total } = await db.getInboundTransfers({
        stxAddress,
        limit,
        offset,
        sendManyContractId,
        height: heightFilter,
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
  });

  return router;
}
