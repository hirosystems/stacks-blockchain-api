import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as Bluebird from 'bluebird';
import { DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { formatMapToObject, isValidPrincipal } from '../../helpers';
import { getTxFromDataStore, parseDbEvent } from '../controllers/db-controller';
import {
  TransactionResults,
  TransactionEvent,
  AddressBalanceResponse,
  AddressStxBalanceResponse,
} from '@blockstack/stacks-blockchain-api-types';

const MAX_TX_PER_REQUEST = 50;
const MAX_ASSETS_PER_REQUEST = 50;

const parseTxQueryLimit = parseLimitQuery({
  maxItems: MAX_TX_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TX_PER_REQUEST,
});

const parseAssetsQueryLimit = parseLimitQuery({
  maxItems: MAX_ASSETS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_ASSETS_PER_REQUEST,
});

interface AddressAssetEvents {
  results: TransactionEvent[];
  limit: number;
  offset: number;
  total: number;
}

export function createAddressRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/:stx_address/stx', async (req, res) => {
    const stxAddress = req.params['stx_address'];
    if (!isValidPrincipal(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }
    // Get balance info for STX token
    const { balance, totalSent, totalReceived } = await db.getStxBalance(stxAddress);
    const result: AddressStxBalanceResponse = {
      balance: balance.toString(),
      total_sent: totalSent.toString(),
      total_received: totalReceived.toString(),
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
    const { balance, totalSent, totalReceived } = await db.getStxBalance(stxAddress);

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
        balance: balance.toString(),
        total_sent: totalSent.toString(),
        total_received: totalReceived.toString(),
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

    const limit = parseTxQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);
    const { results: txResults, total } = await db.getAddressTxs({
      stxAddress: stxAddress,
      limit,
      offset,
    });
    const results = await Bluebird.mapSeries(txResults, async tx => {
      const txQuery = await getTxFromDataStore(tx.tx_id, db);
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

  return router;
}
