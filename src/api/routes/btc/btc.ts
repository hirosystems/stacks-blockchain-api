import * as express from 'express';
import { getBlockFromDataStore, getBlocksWithMetadata } from '../../controllers/db-controller';
import { has0xPrefix } from '../../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../../errors';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../../pagination';
import { getBlockHeightPathParam, validateRequestHexInput } from '../../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import * as stacksApiClient from '@stacks/blockchain-api-client';
import * as stackApiTypes from '@stacks/stacks-blockchain-api-types';

import {
  decodeLeaderBlockCommit,
  decodeLeaderVrfKeyRegistration,
  decodeStxTransferOp,
  fetchJson,
  getAddressInfo,
} from './utils';
import { BLOCKCHAIN_EXPLORER_ENDPOINT, BLOCKCHAIN_INFO_API_ENDPOINT, STACKS_API_ENDPOINT, STACKS_EXPLORER_ENDPOINT } from './consts';
import fetch, { RequestInit } from 'node-fetch';
import BigNumber from 'bignumber.js';
import { b58ToC32 } from 'c32check';
import * as btc from 'bitcoinjs-lib';

export function createBtcRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get('/addr/:address', cacheHandler, (req, res) => {
    const addrInfo = getAddressInfo(req.params.address, req.query.network);
    res.json(addrInfo);
  });

  router.get(
    '/addr/:address/balances',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const addrInfo = getAddressInfo(req.params.address, 'mainnet');

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
      const stxApiConfig = new stacksApiClient.Configuration();
      const stxBlockApi = new stacksApiClient.BlocksApi(stxApiConfig);
      let stxBlockData: stacksApiClient.Block;
      let stxBlockHash: string;
      let stxBlockHeight: number;
      if (typeof req.params.block === 'string') {
        stxBlockHash = req.params.block.toLowerCase();
        if (!stxBlockHash.startsWith('0x')) {
          stxBlockHash + '0x' + stxBlockHash;
        }
        stxBlockData = (await stxBlockApi.getBlockByHash({
          hash: stxBlockHash,
        })) as stacksApiClient.Block;
        stxBlockHeight = stxBlockData.height;
      } else {
        stxBlockHeight = req.params.block;
        stxBlockData = (await stxBlockApi.getBlockByHeight({
          height: stxBlockHeight,
        })) as stacksApiClient.Block;
        stxBlockHash = stxBlockData.hash;
      }

      const btcBlockDataUrl = new URL(
        `/rawblock/${stxBlockData.burn_block_height}`,
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

      const winner = leaderBlockCommits.find(tx => tx?.txid === stxBlockData.miner_txid.slice(2));
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

  router.get(
    '/btc-block-stx-ops/:block',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const btcBlockDataUrl = new URL(
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


  router.get(
    '/btc-info-from-stx-tx/:txid',  
    cacheHandler,
    asyncHandler(async (req, res) => {
      let { txid } = req.params;
      txid = txid.toLocaleLowerCase();
      if (!txid.startsWith('0x')) {
        txid + '0x' + txid;
      }
      const stxApiConfig = new stacksApiClient.Configuration();
      const stxTxApi = new stacksApiClient.TransactionsApi(stxApiConfig);
      const stxBlockApi = new stacksApiClient.BlocksApi(stxApiConfig);
      const stxTxData = await stxTxApi.getTransactionById({ txId: txid }) as stackApiTypes.Transaction;
      const stxBlockHash = stxTxData.block_hash;
      const stxBlockData = await stxBlockApi.getBlockByHash({ hash: stxBlockHash }) as stackApiTypes.Block;
      const btcMinerTx = stxBlockData.miner_txid.slice(2);
      const btcBlockHash = stxBlockData.burn_block_hash.slice(2);

      const stacksBlockExplorerLink = new URL(`/block/${stxBlockHash}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT);
      const stacksTxExplorerLink = new URL(`/txid/${txid}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT);

      const btcBlockExplorerLink = new URL(`/btc/block/${btcBlockHash}`, BLOCKCHAIN_EXPLORER_ENDPOINT);
      const btcTxExplorerLink = new URL(`/btc/tx/${btcMinerTx}`, BLOCKCHAIN_EXPLORER_ENDPOINT);

      // const btcBlockDataUrl = new URL(`/rawblock/${btcBlockHash}`, BLOCKCHAIN_INFO_API_ENDPOINT);
      const btcTxDataUrl = new URL(`/rawtx/${btcMinerTx}`, BLOCKCHAIN_INFO_API_ENDPOINT);

      const btcTxData = await fetchJson<{inputs: { prev_out: { addr: string }}[]}>({ url: btcTxDataUrl });
      const btcMinerAddr = btcTxData.result === 'ok' ? (btcTxData.response.inputs[0]?.prev_out?.addr ?? "") : "";
      const btcMinerAddrExplorerLink = new URL(`/btc/address/${btcMinerAddr}`, BLOCKCHAIN_EXPLORER_ENDPOINT);

      const stxMinerAddr = btcMinerAddr ? getAddressInfo(btcMinerAddr).stacks : "";
      const stxMinerAddrExplorerLink = stxMinerAddr ? new URL(`/address/${stxMinerAddr}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT) : null;

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
        minerStxAddressExplorer: stxMinerAddrExplorerLink?.toString() ?? "",
      };

      res.type('application/json').send(payload);
  }));

  router.get(
    '/btc-info-from-stx-tx/:txid',  
    cacheHandler,
    asyncHandler(async (req, res) => {
    const { block } = request.params;

    const stxApiConfig = new stacksApiClient.Configuration({ fetchApi: undiciFetch });
    const stxBlockApi = new stacksApiClient.BlocksApi(stxApiConfig);

    let stxBlockData: stackApiTypes.Block;
    let stxBlockHash: string;
    let stxBlockHeight: number;
    if (typeof block === 'string') {
      stxBlockHash = block.toLowerCase();
      if (!stxBlockHash.startsWith('0x')) {
        stxBlockHash + '0x' + stxBlockHash;
      }
      stxBlockData = await stxBlockApi.getBlockByHash({ hash: stxBlockHash }) as stackApiTypes.Block;
      stxBlockHeight = stxBlockData.height;
    } else {
      stxBlockHeight = block;
      stxBlockData = await stxBlockApi.getBlockByHeight({ height: stxBlockHeight }) as stackApiTypes.Block;
      stxBlockHash = stxBlockData.hash;
    }

    const btcMinerTx = stxBlockData.miner_txid.slice(2);
    const btcBlockHash = stxBlockData.burn_block_hash.slice(2);

    const stacksBlockExplorerLink = new URL(`/block/${stxBlockHash}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT);

    const btcBlockExplorerLink = new URL(`/btc/block/${btcBlockHash}`, BLOCKCHAIN_EXPLORER_ENDPOINT);
    const btcTxExplorerLink = new URL(`/btc/tx/${btcMinerTx}`, BLOCKCHAIN_EXPLORER_ENDPOINT);

    const btcTxDataUrl = new URL(`/rawtx/${btcMinerTx}`, BLOCKCHAIN_INFO_API_ENDPOINT);

    const btcTxData = await fetchJson<{inputs: { prev_out: { addr: string }}[]}>({ url: btcTxDataUrl });
    const btcMinerAddr = btcTxData.result === 'ok' ? (btcTxData.response.inputs[0]?.prev_out?.addr ?? null) : "";
    const btcMinerAddrExplorerLink = new URL(`/btc/address/${btcMinerAddr}`, BLOCKCHAIN_EXPLORER_ENDPOINT);

    const stxMinerAddr = btcMinerAddr ? getAddressInfo(btcMinerAddr).stacks : "";
    const stxMinerAddrExplorerLink = stxMinerAddr ? new URL(`/address/${stxMinerAddr}?chain=mainnet`, STACKS_EXPLORER_ENDPOINT) : "";

    const payload = {
      stacksBlockHash: stxBlockHash,
      stacksBlockExplorer: stacksBlockExplorerLink.toString(),
      bitcoinBlockHash: btcBlockHash,
      bitcoinBlockExplorer: btcBlockExplorerLink.toString(),
      bitcoinTx: btcMinerTx,
      bitcoinTxExplorer: btcTxExplorerLink.toString(),
      minerBtcAddress: btcMinerAddr,
      minerBtcAddressExplorer: btcMinerAddrExplorerLink.toString(),
      minerStxAddress: stxMinerAddr,
      minerStxAddressExplorer: stxMinerAddrExplorerLink?.toString() ?? "",
    };

    reply.type('application/json').send(payload);
  });

  fastify.get('/stx-block', {
    schema: {
      tags: ['Bitcoin info'],
      summary: 'Get the Stacks block associated with a Bitcoin block',
      description: 'Get the Stacks block information associated with a given Bitcoin block hash or Bitcoin block height',
      querystring: Type.Object({
        'btc-block': Type.Union([
          Type.String({
            description: 'A bitcoin block hash',
            pattern: '^([0-9a-fA-F]{64})$',
          }),
          Type.Integer({
            description: 'A bitcoin block height'
          })
        ], {
          examples: ['00000000000000000007a5a46a5989b1e787346c3179a7e7d31ad99abdbc57c8', 746815],
        }),
      }),
      response: {
        200: Type.Object({
          height:  Type.Number({
            description: 'Stacks block height',
            examples: [69320]
          }),
          hash: Type.String({
            description: 'Stacks block hash',
            examples: ['0x2e4a0e32bc4ea2cd747644a65c73d8f07873fd97ff0227d1aec2e9b264d37f6a']
          }),
          parent_block_hash: Type.String({
            description: 'Stacks parent block hash',
            examples: ['0xf6312ad452b7dbed13f3f6754d851e03d1f93d649a78f83ca977fe878b2df69c']
          }),
        }, {
          description: 'Stacks block related to the given Bitcoin block'
        })
      }
    }
  }, async (req, reply) => {
    let stxBlock: any;
    if (typeof req.query['btc-block'] === 'string') {
      const stxBlockRes = await request(
        `${STACKS_API_ENDPOINT}/extended/v1/block/by_burn_block_hash/0x${req.query['btc-block']}`,
        { method: 'GET' }
      );
      stxBlock = await stxBlockRes.body.json();
    } else {
      const stxBlockRes = await request(
        `${STACKS_API_ENDPOINT}/extended/v1/block/by_burn_block_height/${req.query['btc-block']}`,
        { method: 'GET' }
      );
      stxBlock = await stxBlockRes.body.json();
    }
    reply.type('application/json').send({
      height: stxBlock.height,
      hash: stxBlock.hash,
      parent_block_hash: stxBlock.parent_block_hash
    });
  });
}


  return router;
}
