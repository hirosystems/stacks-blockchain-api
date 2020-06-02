import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { c32addressDecode } from 'c32check';

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
    [name: string]: string;
  };
  non_fungible_tokens: {
    [name: string]: number;
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
    const result: AddressBalanceResponse = {
      stx: {
        balance: balance.toString(),
        total_sent: totalSent.toString(),
        total_received: totalReceived.toString(),
      },
      // TODO: implement fungible_tokens balance query
      fungible_tokens: {},
      // TODO: implement non_fungible_tokens count query
      non_fungible_tokens: {},
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
