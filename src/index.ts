import * as net from 'net';
import { Readable } from 'stream';
import { inspect } from 'util';
import watch from 'node-watch';
import { exec } from 'child_process';

import { readMessageFromStream, parseMessageTransactions } from './event-stream/reader';
import { CoreNodeMessage, CoreNodeEventType } from './event-stream/core-node-message';
import { loadDotEnv, hexToBuffer } from './helpers';
import {
  DataStore,
  DbSmartContractEvent,
  DbStxEvent,
  DbAssetEventTypeId,
  DbFtEvent,
  DbNftEvent,
  createDbTxFromCoreMsg,
  DbEventBase,
  DbEventTypeId,
} from './datastore/common';
import { PgDataStore } from './datastore/postgres-store';
import { MemoryDataStore } from './datastore/memory-store';
import { startApiServer } from './api/init';
import { TransactionPayloadTypeID } from './p2p/tx';

loadDotEnv();

const compileSchemas = process.argv.includes('--compile-schemas');
const generateSchemas = () => exec('npm run generate:schemas');

if (compileSchemas) {
  watch('./docs', { recursive: true, filter: /\.schema\.json$/ }, () => generateSchemas());
}

async function handleClientMessage(clientSocket: Readable, db: DataStore): Promise<void> {
  let msg: CoreNodeMessage;
  try {
    msg = await readMessageFromStream(clientSocket);
  } catch (error) {
    console.error(`error reading messages from socket: ${error}`);
    console.error(error);
    clientSocket.destroy();
    return;
  }
  const parsedMsg = parseMessageTransactions(msg);
  // const stringified = jsonStringify(parsedMsg);
  // console.log(stringified);
  await db.updateBlock({ ...parsedMsg, canonical: true });
  for (let i = 0; i < parsedMsg.transactions.length; i++) {
    const tx = parsedMsg.parsed_transactions[i];
    await db.updateTx(createDbTxFromCoreMsg(tx));
    if (tx.raw_tx.payload.typeId === TransactionPayloadTypeID.SmartContract) {
      const contractId = `${tx.sender_address}.${tx.raw_tx.payload.name}`;
      await db.updateSmartContract({
        tx_id: tx.core_tx.txid,
        contract_id: contractId,
        block_height: parsedMsg.block_height,
        source_code: tx.raw_tx.payload.codeBody,
        abi: JSON.stringify(tx.core_tx.contract_abi),
        canonical: true,
      });
    }
  }
  for (let i = 0; i < parsedMsg.events.length; i++) {
    const event = parsedMsg.events[i];
    const dbEvent: DbEventBase = {
      event_index: i,
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
        await db.updateSmartContractEvent(entry);
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
        await db.updateStxEvent(entry);
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
        await db.updateStxEvent(entry);
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
        await db.updateStxEvent(entry);
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
        await db.updateFtEvent(entry);
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
        await db.updateFtEvent(entry);
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
        await db.updateNftEvent(entry);
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
        await db.updateNftEvent(entry);
        break;
      }
      default: {
        throw new Error(`Unexpected CoreNodeEventType: ${inspect(event)}`);
      }
    }
  }
}

async function startEventSocketServer(db: DataStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(clientSocket => {
      handleClientMessage(clientSocket, db).catch(error => {
        console.error(`error processing socket connection: ${error}`);
        console.error(error);
      });
      clientSocket.on('end', () => {
        // do nothing for now
      });
    });
    server.on('error', error => {
      console.error(`socket server error: ${error}`);
      reject(error);
    });
    const socketHost = process.env['STACKS_SIDECAR_SOCKET_HOST'];
    const socketPort = Number.parseInt(process.env['STACKS_SIDECAR_SOCKET_PORT'] ?? '', 10);
    if (!socketHost) {
      throw new Error(
        `STACKS_SIDECAR_SOCKET_HOST must be specified, e.g. "STACKS_SIDECAR_SOCKET_HOST=127.0.0.1"`
      );
    }
    if (!socketPort) {
      throw new Error(
        `STACKS_SIDECAR_SOCKET_PORT must be specified, e.g. "STACKS_SIDECAR_SOCKET_PORT=3700"`
      );
    }
    server.listen(socketPort, socketHost, () => {
      const addr = server.address();
      if (addr === null) {
        throw new Error('server missing address');
      }
      const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
      console.log(`core node event server listening at ${addrStr}`);
      resolve();
    });
  });
}

async function init(): Promise<void> {
  let db: DataStore;
  switch (process.env['STACKS_SIDECAR_DB']) {
    case 'memory': {
      console.log('using in-memory db');
      db = new MemoryDataStore();
      break;
    }
    case 'pg':
    case undefined: {
      db = await PgDataStore.connect();
      break;
    }
    default: {
      throw new Error(`invalid STACKS_SIDECAR_DB option: "${process.env['STACKS_SIDECAR_DB']}"`);
    }
  }
  await startEventSocketServer(db);
  await startApiServer(db);
}

init()
  .then(() => {
    console.log('app started');
  })
  .catch(error => {
    console.error(`app failed to start: ${error}`);
    console.error(error);
    process.exit(1);
  });
