import { inspect } from 'util';
import * as net from 'net';
import { Server } from 'http';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import { addAsync } from '@awaitjs/express';
import PQueue from 'p-queue';

import { hexToBuffer } from '../helpers';
import { CoreNodeMessage, CoreNodeEventType } from './core-node-message';
import {
  DataStore,
  createDbTxFromCoreMsg,
  DbEventBase,
  DbSmartContractEvent,
  DbStxEvent,
  DbEventTypeId,
  DbFtEvent,
  DbAssetEventTypeId,
  DbNftEvent,
  DbBlock,
  DataStoreUpdateData,
} from '../datastore/common';
import { parseMessageTransactions } from './reader';
import { TransactionPayloadTypeID } from '../p2p/tx';

async function handleClientMessage(msg: CoreNodeMessage, db: DataStore): Promise<void> {
  const parsedMsg = parseMessageTransactions(msg);

  const dbBlock: DbBlock = {
    canonical: true,
    block_hash: parsedMsg.block_hash,
    index_block_hash: parsedMsg.index_block_hash,
    parent_block_hash: parsedMsg.parent_block_hash,
    parent_microblock: parsedMsg.parent_microblock,
    block_height: parsedMsg.block_height,
    burn_block_time: parsedMsg.burn_block_time,
  };

  const dbData: DataStoreUpdateData = {
    block: dbBlock,
    txs: new Array(parsedMsg.transactions.length),
  };

  for (let i = 0; i < parsedMsg.transactions.length; i++) {
    const tx = parsedMsg.parsed_transactions[i];
    dbData.txs[i] = {
      tx: createDbTxFromCoreMsg(tx),
      stxEvents: [],
      ftEvents: [],
      nftEvents: [],
      contractLogEvents: [],
      smartContracts: [],
    };
    if (tx.raw_tx.payload.typeId === TransactionPayloadTypeID.SmartContract) {
      const contractId = `${tx.sender_address}.${tx.raw_tx.payload.name}`;
      dbData.txs[i].smartContracts.push({
        tx_id: tx.core_tx.txid,
        contract_id: contractId,
        block_height: parsedMsg.block_height,
        source_code: tx.raw_tx.payload.codeBody,
        abi: JSON.stringify(tx.core_tx.contract_abi),
        canonical: true,
      });
    }
  }

  for (const event of parsedMsg.events) {
    const dbTx = dbData.txs.find(entry => entry.tx.tx_id === event.txid);
    if (!dbTx) {
      throw new Error(`Unexpected missing tx during event parsing by tx_id ${event.txid}`);
    }
    // TODO: this is not a real event_index -- the core-node needs to keep track and return in better format.
    const eventIndex =
      dbTx.stxEvents.length +
      dbTx.ftEvents.length +
      dbTx.nftEvents.length +
      dbTx.contractLogEvents.length;

    const dbEvent: DbEventBase = {
      event_index: eventIndex,
      tx_id: event.txid,
      block_height: parsedMsg.block_height,
      canonical: true,
    };

    switch (event.type) {
      case CoreNodeEventType.ContractEvent: {
        const entry: DbSmartContractEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.SmartContractLog,
          contract_identifier: event.contract_event.contract_identifier,
          topic: event.contract_event.topic,
          value: hexToBuffer(event.contract_event.raw_value),
        };
        dbTx.contractLogEvents.push(entry);
        break;
      }
      case CoreNodeEventType.StxTransferEvent: {
        const entry: DbStxEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          sender: event.stx_transfer_event.sender,
          recipient: event.stx_transfer_event.recipient,
          amount: BigInt(event.stx_transfer_event.amount),
        };
        dbTx.stxEvents.push(entry);
        break;
      }
      case CoreNodeEventType.StxMintEvent: {
        const entry: DbStxEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: event.stx_mint_event.recipient,
          amount: BigInt(event.stx_mint_event.amount),
        };
        dbTx.stxEvents.push(entry);
        break;
      }
      case CoreNodeEventType.StxBurnEvent: {
        const entry: DbStxEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Burn,
          sender: event.stx_burn_event.sender,
          amount: BigInt(event.stx_burn_event.amount),
        };
        dbTx.stxEvents.push(entry);
        break;
      }
      case CoreNodeEventType.FtTransferEvent: {
        const entry: DbFtEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.FungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          sender: event.ft_transfer_event.sender,
          recipient: event.ft_transfer_event.recipient,
          asset_identifier: event.ft_transfer_event.asset_identifier,
          amount: BigInt(event.ft_transfer_event.amount),
        };
        dbTx.ftEvents.push(entry);
        break;
      }
      case CoreNodeEventType.FtMintEvent: {
        const entry: DbFtEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.FungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: event.ft_mint_event.recipient,
          asset_identifier: event.ft_mint_event.asset_identifier,
          amount: BigInt(event.ft_mint_event.amount),
        };
        dbTx.ftEvents.push(entry);
        break;
      }
      case CoreNodeEventType.NftTransferEvent: {
        const entry: DbNftEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          recipient: event.nft_transfer_event.recipient,
          sender: event.nft_transfer_event.sender,
          asset_identifier: event.nft_transfer_event.asset_identifier,
          value: hexToBuffer(event.nft_transfer_event.raw_value),
        };
        dbTx.nftEvents.push(entry);
        break;
      }
      case CoreNodeEventType.NftMintEvent: {
        const entry: DbNftEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: event.nft_mint_event.recipient,
          asset_identifier: event.nft_mint_event.asset_identifier,
          value: hexToBuffer(event.nft_mint_event.raw_value),
        };
        dbTx.nftEvents.push(entry);
        break;
      }
      default: {
        throw new Error(`Unexpected CoreNodeEventType: ${inspect(event)}`);
      }
    }
  }

  await db.update(dbData);
}

type MessageHandler = (msg: CoreNodeMessage, db: DataStore) => Promise<void> | void;

function createMessageProcessorQueue(): MessageHandler {
  // Create a promise queue so that only one message is handled at a time.
  const processorQueue = new PQueue({ concurrency: 1 });
  const handleFn = async (msg: CoreNodeMessage, db: DataStore): Promise<void> => {
    await processorQueue.add(() => handleClientMessage(msg, db));
  };
  return handleFn;
}

export async function startEventServer(
  db: DataStore,
  messageHandler: MessageHandler = createMessageProcessorQueue()
): Promise<net.Server> {
  let eventHost = process.env['STACKS_SIDECAR_EVENT_HOST'];
  const eventPort = parseInt(process.env['STACKS_SIDECAR_EVENT_PORT'] ?? '', 10);
  if (!eventHost) {
    throw new Error(
      `STACKS_SIDECAR_EVENT_HOST must be specified, e.g. "STACKS_SIDECAR_EVENT_HOST=127.0.0.1"`
    );
  }
  if (!eventPort) {
    throw new Error(
      `STACKS_SIDECAR_EVENT_PORT must be specified, e.g. "STACKS_SIDECAR_EVENT_PORT=3700"`
    );
  }

  if (eventHost.startsWith('http:')) {
    const { hostname } = new URL(eventHost);
    eventHost = hostname;
  }

  const app = addAsync(express());
  app.use(bodyParser.json({ type: 'application/json', limit: '25MB' }));
  app.getAsync('/', (req, res) => {
    res
      .status(200)
      .json({ status: 'ready', msg: 'Sidecar event server listening for core-node POST messages' });
  });
  app.postAsync('/', async (req, res) => {
    try {
      const msg: CoreNodeMessage = req.body;
      await messageHandler(msg, db);
      res.status(200).json({ result: 'ok' });
    } catch (error) {
      console.error(`error processing core-node message: ${error}`);
      console.error(error);
      res.status(500).json({ error: error });
    }
  });

  const server = await new Promise<Server>(resolve => {
    const server = app.listen(eventPort, eventHost!, () => resolve(server));
  });

  const addr = server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  console.log(`Event observer listening at: http://${addrStr}`);

  return server;
}
