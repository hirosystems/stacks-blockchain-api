import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { c32addressDecode } from 'c32check';
import { formatMapToObject } from '../../helpers';

const MAX_TX_PER_REQUEST = 50;
const MAX_ASSETS_PER_REQUEST = 50;

const parseTxQueryLimit = parseLimitQuery({
  maxItems: MAX_TX_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TX_PER_REQUEST,
});

const parseAssetsQueryLimit = parseLimitQuery({
  maxItems: MAX_ASSETS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TX_PER_REQUEST,
});

function isValidStxAddress(stxAddress: string): boolean {
  try {
    c32addressDecode(stxAddress);
    return true;
  } catch (error) {
    return false;
  }
}

// TODO: define this in json schema
interface AddressBalanceResponse {
  stx: {
    balance: string;
    total_sent: string;
    total_received: string;
  };
  fungible_tokens: {
    [name: string]: {
      balance: string;
      total_sent: string;
      total_received: string;
    };
  };
  non_fungible_tokens: {
    [name: string]: {
      count: string;
      total_sent: string;
      total_received: string;
    };
  };
}

export function createAddressRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  // get balances for STX, FTs, and counts for NFTs
  router.getAsync('/:stx_address/balance', async (req, res) => {
    const stxAddress = req.params['stx_address'];
    if (!isValidStxAddress(stxAddress)) {
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
    if (!isValidStxAddress(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }

    const limit = parseTxQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);
    // TODO: implement get recent address txs
    await Promise.resolve();
  });

  router.getAsync('/:stx_address/assets', async (req, res) => {
    // get recent asset event associated with address
    const stxAddress = req.params['stx_address'];
    if (!isValidStxAddress(stxAddress)) {
      return res.status(400).json({ error: `invalid STX address "${stxAddress}"` });
    }

    const limit = parseAssetsQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);
    // TODO: implement get recent address asset events
    await Promise.resolve();
  });

  return router;
}
