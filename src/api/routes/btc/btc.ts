import * as stackApiTypes from '@stacks/stacks-blockchain-api-types';
import BigNumber from 'bignumber.js';
import { b58ToC32 } from 'c32check';
import * as express from 'express';
import fetch from 'node-fetch';

import * as stacksApiClient from '@stacks/blockchain-api-client';
import { FoundOrNot } from 'src/helpers';

import { PgStore } from '../../../datastore/pg-store';
import { asyncHandler } from '../../async-handler';
import { getETagCacheHandler } from '../../controllers/cache-controller';
import { getBlockFromDataStore, searchTx } from '../../controllers/db-controller';
import {
  BLOCKCHAIN_EXPLORER_ENDPOINT,
  BLOCKCHAIN_INFO_API_ENDPOINT,
  STACKS_API_ENDPOINT,
  STACKS_EXPLORER_ENDPOINT,
} from './consts';
import {
  Network,
  decodeLeaderBlockCommit,
  decodeLeaderVrfKeyRegistration,
  decodeStxTransferOp,
  fetchJson,
  getAddressInfo,
} from './utils';

export function createBtcRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  /**
   * Provide either a Stacks or Bitcoin address, and receive the Stacks address, Bitcoin address, and network version.
   */
  router.get('/addr/:address', cacheHandler, (req, res) => {
    if (req.query.network && req.query.network !== 'mainnet' && req.query.network !== 'testnet') {
      res
        .status(400)
        .send("Query string parameter, network, must be set to either 'mainnet' or 'testnet'");
    }
    const addrInfo = getAddressInfo(req.params.address, req.query.network as Network);
    res.json(addrInfo);
  });

  /**
   * Get the stx and btc balance for an address
   */
  router.get(
    '/addr/:address/balances',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const addrInfo = getAddressInfo(req.params.address, Network.mainnet);

      const stxBalanceReq = await fetch(
        `${STACKS_API_ENDPOINT}/extended/v1/address/${addrInfo.stacks}/balances`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      ); // get api instance
      // const stxBalance = await stxBalanceReq.body.json(); // TODO: Test this change
      const stxBalance = await stxBalanceReq.json();
      const stxBalanceFormatted = new BigNumber(stxBalance.stx.balance).shiftedBy(-6).toFixed(6);
      const btcBalanceReq = await fetch(
        `${BLOCKCHAIN_INFO_API_ENDPOINT}/rawaddr/${addrInfo.bitcoin}?limit=0`
      );
      // const btcBalance = await btcBalanceReq.body.json(); // TODO: Test this change
      const btcBalance = await btcBalanceReq.json();
      const btcBalanceFormatted = new BigNumber(btcBalance.final_balance).shiftedBy(-8).toFixed(8);

      res.json({
        stacks: {
          address: addrInfo.stacks,
          balance: stxBalanceFormatted,
        },
        bitcoin: {
          address: addrInfo.bitcoin,
          balance: btcBalanceFormatted,
        },
      });
    })
  );

  router.get(
    '/miner-participants/:block',
    cacheHandler,
    asyncHandler(async (req, res) => {
      let stxBlockData: FoundOrNot<Block>;
      let stxBlockHash: string;
      let stxBlockHeight: number;

      if (typeof req.params.block === 'string') {
        // TODO: all params are strings
        stxBlockHash = req.params.block.toLowerCase();
        if (!stxBlockHash.startsWith('0x')) {
          stxBlockHash + '0x' + stxBlockHash;
        }

        stxBlockData = await getBlockFromDataStore({
          blockIdentifer: { hash: stxBlockHash },
          db,
        });
        if (!stxBlockData.found) {
          res.status(404).json({ error: `cannot find block by hash ${stxBlockHash}` });
          return;
        }
        // stxBlockData = await stxBlockApi.getBlockByHash({
        //   // TODO: This will eventually be separate infra, but to test try using api functions here vs client
        //   hash: stxBlockHash,
        // });
        stxBlockHeight = stxBlockData.result.height;
      } else {
        stxBlockHeight = req.params.block;
        // stxBlockData = (await stxBlockApi.getBlockByHeight({
        //   height: stxBlockHeight,
        // })) as stacksApiClient.Block;

        stxBlockData = await getBlockFromDataStore({
          blockIdentifer: { height: stxBlockHeight },
          db,
        });
        if (!stxBlockData.found) {
          res.status(404).json({ error: `cannot find block by height ${stxBlockHeight}` });
          return;
        }
        stxBlockHash = stxBlockData.result.hash;
      }

      const btcBlockDataUrl = new URL(
        `/rawblock/${stxBlockData.result.burn_block_height}`,
        BLOCKCHAIN_INFO_API_ENDPOINT
      );
      const btcBlockData = await fetchJson<{
        hash: string;
        height: number;
        tx: {
          hash: string;
          inputs: {
            prev_out: {
              addr?: string;
            };
          }[];
          out: {
            script: string;
            addr?: string;
          }[];
        }[];
      }>({ url: btcBlockDataUrl });
      if (btcBlockData.result !== 'ok') {
        throw new Error(
          `Status: ${btcBlockData.status}, response: ${JSON.stringify(btcBlockData.response)}`
        );
      }

      const leaderBlockCommits = btcBlockData.response.tx
        .filter(tx => tx.out.length > 0)
        .map(tx => {
          try {
            const result = decodeLeaderBlockCommit(tx.out[0].script);
            if (!result) {
              return null;
            }
            const addr = tx.inputs[0]?.prev_out?.addr ?? null;
            return {
              txid: tx.hash,
              address: addr,
              stxAddress: addr ? b58ToC32(addr) : null,
              ...result,
            };
          } catch (error) {
            return null;
          }
        })
        .filter(r => r !== null);

      const winner = leaderBlockCommits.find(
        tx => tx?.txid === stxBlockData.result.miner_txid.slice(2)
      );
      const participants = leaderBlockCommits.map(tx => {
        return {
          btcTx: tx?.txid,
          stxAddress: tx?.stxAddress,
          btcAddress: tx?.address,
        };
      });
      const payload = {
        winner: winner?.stxAddress,
        participants: participants,
      };
      res.send(payload);
    })
  );

  /**
   * Decode any Stacks operations contained with a given Bitcoin block's transactions.
   * Shows Stacks miners that have participated in a given Bitcoin block.
   */
  router.get(
    '/btc-block-stx-ops/:block',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const btcBlockDataUrl = new URL( // TODO: blockchain api dependency
        `/rawblock/${req.params.block}`,
        BLOCKCHAIN_INFO_API_ENDPOINT
      );
      const btcBlockData = await fetchJson<{
        hash: string;
        height: number;
        tx: {
          hash: string;
          inputs: {
            prev_out: {
              addr?: string;
            };
          }[];
          out: {
            script: string;
            addr?: string;
          }[];
        }[];
      }>({ url: btcBlockDataUrl });
      if (btcBlockData.result !== 'ok') {
        throw new Error(
          `Status: ${btcBlockData.status}, response: ${JSON.stringify(btcBlockData.response)}`
        );
      }

      const leaderBlockCommits = btcBlockData.response.tx
        .filter(tx => tx.out.length > 0)
        .map(tx => {
          try {
            const result = decodeLeaderBlockCommit(tx.out[0].script);
            if (!result) {
              return null;
            }
            const addr = tx.inputs[0]?.prev_out?.addr ?? null;
            return {
              txid: tx.hash,
              address: addr,
              stxAddress: addr ? b58ToC32(addr) : null,
              ...result,
            };
          } catch (error) {
            return null;
          }
        })
        .filter(r => r !== null);

      const leaderVrfKeyRegistrations = btcBlockData.response.tx
        .filter(tx => tx.out.length > 0)
        .map(tx => {
          try {
            const result = decodeLeaderVrfKeyRegistration(tx.out[0].script);
            if (!result) {
              return null;
            }
            return {
              txid: tx.hash,
              address: tx.inputs[0]?.prev_out?.addr ?? null,
              ...result,
            };
          } catch (error) {
            return null;
          }
        })
        .filter(r => r !== null);

      const stxTransfers = btcBlockData.response.tx
        .filter(tx => tx.out.length > 0)
        .map(tx => {
          try {
            const result = decodeStxTransferOp(tx.out[0].script);
            if (!result) {
              return null;
            }
            const fromAddr = tx.inputs[0]?.prev_out?.addr ?? null;
            const fromStxAddr = fromAddr ? b58ToC32(fromAddr) : null;
            const toBtcAddr = tx.out[1]?.addr ?? null;
            const toStxAddr = toBtcAddr ? b58ToC32(toBtcAddr) : null;
            return {
              txid: tx.hash,
              address: fromAddr,
              fromAddr: fromStxAddr,
              toAddr: toStxAddr,
              ...result,
            };
          } catch (error) {
            return null;
          }
        })
        .filter(r => r !== null);

      const payload = {
        bitcoinBlockHash: btcBlockData.response.hash,
        bitcoinBlockHeight: btcBlockData.response.height,
        stxTransfers: stxTransfers,
        leaderVrfKeyRegistrations: leaderVrfKeyRegistrations,
        leaderBlockCommits: leaderBlockCommits,
      };
      res.send(payload);
    })
  );

  /**
   * Get Bitcoin information related to a given Stacks transaction
   */
  router.get(
    '/btc-info-from-stx-tx/:txid',
    cacheHandler,
    asyncHandler(async (req, res) => {
      let { txid } = req.params;
      txid = txid.toLocaleLowerCase();
      if (!txid.startsWith('0x')) {
        txid + '0x' + txid;
      }
      // const stxApiConfig = new stacksApiClient.Configuration();
      // const stxTxApi = new stacksApiClient.TransactionsApi(stxApiConfig);
      // const stxBlockApi = new stacksApiClient.BlocksApi(stxApiConfig);

      // const stxTxData = (await stxTxApi.getTransactionById({
      //   txId: txid,
      // })) as stackApiTypes.Transaction;
      // const eventLimit = getPagingQueryLimit(ResourceType.Tx, req.query['event_limit']);
      // const eventOffset = parsePagingQueryInput(req.query['event_offset'] ?? 0);
      const stxTxData = ((await searchTx(db, {
        txId: txid,
        eventLimit: 0,
        eventOffset: 0,
        includeUnanchored: false,
      })) as unknown) as FoundOrNot<stackApiTypes.Transaction>; // TODO: this might not be safe

      const stxBlockHash = stxTxData.result?.block_hash; // TODO: assert this property exists on result
      if (!stxBlockHash) {
        res.status(404).json({ error: `could not find transaction by ID ${txid}` }); // TODO: improve wording
      }

      // if (!has0xPrefix(hash)) {
      //   return res.redirect('/extended/v1/block/0x' + hash);
      // }
      // validateRequestHexInput(hash);

      const stxBlockData = await getBlockFromDataStore({
        blockIdentifer: { hash: stxBlockHash },
        db,
      });
      if (!stxBlockData.found) {
        res.status(404).json({ error: `cannot find block by hash ${stxBlockHash}` });
        return;
      }
      // setETagCacheHeaders(res);
      // const stxBlockData = (await stxBlockApi.getBlockByHash({ hash: stxBlockHash })) as stackApiTypes.Block;

      const btcMinerTx = stxBlockData.result.miner_txid.slice(2);
      const btcBlockHash = stxBlockData.result.burn_block_hash.slice(2);

      const stacksBlockExplorerLink = new URL(
        `/block/${stxBlockHash}?chain=mainnet`,
        STACKS_EXPLORER_ENDPOINT
      );
      const stacksTxExplorerLink = new URL(`/txid/${txid}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT);

      const btcBlockExplorerLink = new URL(
        `/btc/block/${btcBlockHash}`,
        BLOCKCHAIN_EXPLORER_ENDPOINT
      );
      const btcTxExplorerLink = new URL(`/btc/tx/${btcMinerTx}`, BLOCKCHAIN_EXPLORER_ENDPOINT);

      // const btcBlockDataUrl = new URL(`/rawblock/${btcBlockHash}`, BLOCKCHAIN_INFO_API_ENDPOINT);
      const btcTxDataUrl = new URL(`/rawtx/${btcMinerTx}`, BLOCKCHAIN_INFO_API_ENDPOINT);

      const btcTxData = await fetchJson<{ inputs: { prev_out: { addr: string } }[] }>({
        url: btcTxDataUrl,
      });
      const btcMinerAddr =
        btcTxData.result === 'ok' ? btcTxData.response.inputs[0]?.prev_out?.addr ?? '' : '';
      const btcMinerAddrExplorerLink = new URL(
        `/btc/address/${btcMinerAddr}`,
        BLOCKCHAIN_EXPLORER_ENDPOINT
      );

      const stxMinerAddr = btcMinerAddr ? getAddressInfo(btcMinerAddr).stacks : '';
      const stxMinerAddrExplorerLink = stxMinerAddr
        ? new URL(`/address/${stxMinerAddr}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT)
        : null;

      const payload = {
        stacksTx: txid,
        stacksTxExplorer: stacksTxExplorerLink.toString(),
        stacksBlockHash: stxBlockHash,
        stacksBlockExplorer: stacksBlockExplorerLink.toString(),
        bitcoinBlockHash: btcBlockHash,
        bitcoinBlockExplorer: btcBlockExplorerLink.toString(),
        bitcoinTx: btcMinerTx,
        bitcoinTxExplorer: btcTxExplorerLink.toString(),
        minerBtcAddress: btcMinerAddr,
        minerBtcAddressExplorer: btcMinerAddrExplorerLink.toString(),
        minerStxAddress: stxMinerAddr,
        minerStxAddressExplorer: stxMinerAddrExplorerLink?.toString() ?? '',
      };

      res.type('application/json').send(payload);
    })
  );

  /**
   * Get the Stacks block information associated with a given Bitcoin block hash or Bitcoin block height
   */
  router.get(
    '/stx-block',
    cacheHandler,
    asyncHandler(async (req, reply) => {
      let stxBlock: any;
      if (typeof req.query['btc-block'] === 'string') {
        // TODO: query string is always a string. Find function that will determine if the input is a btc hash
        const stxBlockRes = await fetch(
          `${STACKS_API_ENDPOINT}/extended/v1/block/by_burn_block_hash/0x${req.query['btc-block']}`,
          { method: 'GET' }
        );
        stxBlock = await stxBlockRes.json();
      } else {
        const stxBlockRes = await fetch(
          `${STACKS_API_ENDPOINT}/extended/v1/block/by_burn_block_height/${req.query['btc-block']}`,
          { method: 'GET' }
        );
        stxBlock = await stxBlockRes.json();
      }
      reply.type('application/json').send({
        height: stxBlock.height,
        hash: stxBlock.hash,
        parent_block_hash: stxBlock.parent_block_hash,
      });
    })
  );

  return router;
}
