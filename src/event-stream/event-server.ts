import { inspect } from 'util';
import * as net from 'net';
import Fastify, { FastifyRequest, FastifyServerOptions } from 'fastify';
import PQueue from 'p-queue';
import * as prom from 'prom-client';
import {
  BitVec,
  ChainID,
  assertNotNullish,
  getChainIDNetwork,
  getIbdBlockHeight,
} from '../helpers';
import {
  CoreNodeBlockMessage,
  CoreNodeEventType,
  CoreNodeBurnBlockMessage,
  CoreNodeDropMempoolTxMessage,
  CoreNodeAttachmentMessage,
  CoreNodeMicroblockMessage,
  CoreNodeParsedTxMessage,
  CoreNodeEvent,
} from './core-node-message';
import {
  DbEventBase,
  DbSmartContractEvent,
  DbStxEvent,
  DbEventTypeId,
  DbFtEvent,
  DbAssetEventTypeId,
  DbNftEvent,
  DbBlock,
  DataStoreBlockUpdateData,
  DbStxLockEvent,
  DbMinerReward,
  DbBurnchainReward,
  DbRewardSlotHolder,
  DataStoreMicroblockUpdateData,
  DataStoreTxEventData,
  DbMicroblock,
  DataStoreAttachmentData,
  DbPoxSyntheticEvent,
  DbTxStatus,
  DbBnsSubdomain,
  DbPoxSetSigners,
} from '../datastore/common';
import {
  getTxSenderAddress,
  getTxSponsorAddress,
  parseMessageTransaction,
  CoreNodeMsgBlockData,
  parseMicroblocksFromTxs,
  isPoxPrintEvent,
  newCoreNoreBlockEventCounts,
} from './reader';
import {
  decodeTransaction,
  decodeClarityValue,
  ClarityValueBuffer,
  ClarityValueStringAscii,
  ClarityValueTuple,
  TxPayloadTypeID,
} from 'stacks-encoding-native-js';
import { BnsContractIdentifier } from './bns/bns-constants';
import {
  parseNameFromContractEvent,
  parseNameRenewalWithNoZonefileHashFromContractCall,
  parseNamespaceFromContractEvent,
  parseZoneFileTxt,
  parseResolver,
} from './bns/bns-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import {
  createDbMempoolTxFromCoreMsg,
  createDbTxFromCoreMsg,
  getTxDbStatus,
} from '../datastore/helpers';
import { handleBnsImport } from '../import-v1';
import { decodePoxSyntheticPrintEvent } from './pox-event-parsing';
import { logger } from '../logger';
import * as zoneFileParser from 'zone-file';
import { hexToBuffer, isProdEnv, PINO_LOGGER_CONFIG, stopwatch } from '@hirosystems/api-toolkit';
import { POX_2_CONTRACT_NAME, POX_3_CONTRACT_NAME, POX_4_CONTRACT_NAME } from '../pox-helpers';

const IBD_PRUNABLE_ROUTES = ['/new_mempool_tx', '/drop_mempool_tx', '/new_microblocks'];

async function handleRawEventRequest(
  eventPath: string,
  payload: any,
  db: PgWriteStore
): Promise<void> {
  await db.storeRawEventRequest(eventPath, payload);
}

async function handleBurnBlockMessage(
  burnBlockMsg: CoreNodeBurnBlockMessage,
  db: PgWriteStore
): Promise<void> {
  logger.debug(
    `Received burn block message hash ${burnBlockMsg.burn_block_hash}, height: ${burnBlockMsg.burn_block_height}, reward recipients: ${burnBlockMsg.reward_recipients.length}`
  );
  const rewards = burnBlockMsg.reward_recipients.map((r, index) => {
    const dbReward: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: burnBlockMsg.burn_block_hash,
      burn_block_height: burnBlockMsg.burn_block_height,
      burn_amount: BigInt(burnBlockMsg.burn_amount),
      reward_recipient: r.recipient,
      reward_amount: BigInt(r.amt),
      reward_index: index,
    };
    return dbReward;
  });
  const slotHolders = burnBlockMsg.reward_slot_holders.map((r, index) => {
    const slotHolder: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: burnBlockMsg.burn_block_hash,
      burn_block_height: burnBlockMsg.burn_block_height,
      address: r,
      slot_index: index,
    };
    return slotHolder;
  });
  await db.updateBurnchainRewards({
    burnchainBlockHash: burnBlockMsg.burn_block_hash,
    burnchainBlockHeight: burnBlockMsg.burn_block_height,
    rewards: rewards,
  });
  await db.updateBurnchainRewardSlotHolders({
    burnchainBlockHash: burnBlockMsg.burn_block_hash,
    burnchainBlockHeight: burnBlockMsg.burn_block_height,
    slotHolders: slotHolders,
  });
}

async function handleMempoolTxsMessage(rawTxs: string[], db: PgWriteStore): Promise<void> {
  logger.debug(`Received ${rawTxs.length} mempool transactions`);
  // TODO: mempool-tx receipt date should be sent from the core-node
  const receiptDate = Math.round(Date.now() / 1000);
  const decodedTxs = rawTxs.map(str => {
    const parsedTx = decodeTransaction(str);
    const txSender = getTxSenderAddress(parsedTx);
    const sponsorAddress = getTxSponsorAddress(parsedTx);
    return {
      txId: parsedTx.tx_id,
      sender: txSender,
      sponsorAddress,
      txData: parsedTx,
      rawTx: str,
    };
  });
  const dbMempoolTxs = decodedTxs.map(tx => {
    logger.debug(`Received mempool tx: ${tx.txId}`);
    const dbMempoolTx = createDbMempoolTxFromCoreMsg({
      txId: tx.txId,
      txData: tx.txData,
      sender: tx.sender,
      sponsorAddress: tx.sponsorAddress,
      rawTx: tx.rawTx,
      receiptDate: receiptDate,
    });
    return dbMempoolTx;
  });
  await db.updateMempoolTxs({ mempoolTxs: dbMempoolTxs });
}

async function handleDroppedMempoolTxsMessage(
  msg: CoreNodeDropMempoolTxMessage,
  db: PgWriteStore
): Promise<void> {
  logger.debug(`Received ${msg.dropped_txids.length} dropped mempool txs`);
  const dbTxStatus = getTxDbStatus(msg.reason);
  await db.dropMempoolTxs({ status: dbTxStatus, txIds: msg.dropped_txids });
}

async function handleMicroblockMessage(
  chainId: ChainID,
  msg: CoreNodeMicroblockMessage,
  db: PgWriteStore
): Promise<void> {
  logger.debug(`Received microblock with ${msg.transactions.length} txs`);
  const dbMicroblocks = parseMicroblocksFromTxs({
    parentIndexBlockHash: msg.parent_index_block_hash,
    txs: msg.transactions,
    parentBurnBlock: {
      height: msg.burn_block_height,
      hash: msg.burn_block_hash,
      time: msg.burn_block_timestamp,
    },
  });
  const stacksBlockReceiptDate = Math.round(Date.now() / 1000);
  const parsedTxs: CoreNodeParsedTxMessage[] = [];
  msg.transactions.forEach(tx => {
    const blockData: CoreNodeMsgBlockData = {
      parent_index_block_hash: msg.parent_index_block_hash,

      parent_burn_block_timestamp: msg.burn_block_timestamp,
      parent_burn_block_height: msg.burn_block_height,
      parent_burn_block_hash: msg.burn_block_hash,

      // These properties aren't known until the next anchor block that accepts this microblock.
      burn_block_time: -1,
      burn_block_height: -1,
      index_block_hash: '',
      block_hash: '',
      block_time: stacksBlockReceiptDate,

      // These properties can be determined with a db query, they are set while the db is inserting them.
      block_height: -1,
      parent_block_hash: '',
    };
    const parsedTx = parseMessageTransaction(chainId, tx, blockData, msg.events);
    if (parsedTx) {
      parsedTxs.push(parsedTx);
    }
  });
  parsedTxs.forEach(tx => {
    logger.debug(`Received microblock mined tx: ${tx.core_tx.txid}`);
  });
  const updateData: DataStoreMicroblockUpdateData = {
    microblocks: dbMicroblocks,
    txs: parseDataStoreTxEventData(
      parsedTxs,
      msg.events,
      {
        block_height: -1, // TODO: fill during initial db insert
        index_block_hash: '',
        block_time: stacksBlockReceiptDate,
      },
      chainId
    ),
  };
  await db.updateMicroblocks(updateData);
}

async function handleBlockMessage(
  chainId: ChainID,
  msg: CoreNodeBlockMessage,
  db: PgWriteStore
): Promise<void> {
  const ingestionTimer = stopwatch();
  const { dbData, counts } = parseNewBlockMessage(chainId, msg, db.isEventReplay);
  await db.update(dbData);
  const ingestionTime = ingestionTimer.getElapsed();
  logger.info(
    counts,
    `Ingested block ${msg.block_height} (${msg.block_hash}) in ${ingestionTime}ms`
  );
}

function parseDataStoreTxEventData(
  parsedTxs: CoreNodeParsedTxMessage[],
  events: CoreNodeEvent[],
  blockData: {
    block_height: number;
    index_block_hash: string;
    block_time: number;
  },
  chainId: ChainID
): DataStoreTxEventData[] {
  const dbData: DataStoreTxEventData[] = parsedTxs.map(tx => {
    const dbTx: DataStoreBlockUpdateData['txs'][number] = {
      tx: createDbTxFromCoreMsg(tx),
      stxEvents: [],
      stxLockEvents: [],
      ftEvents: [],
      nftEvents: [],
      contractLogEvents: [],
      smartContracts: [],
      names: [],
      namespaces: [],
      pox2Events: [],
      pox3Events: [],
      pox4Events: [],
    };
    switch (tx.parsed_tx.payload.type_id) {
      case TxPayloadTypeID.VersionedSmartContract:
      case TxPayloadTypeID.SmartContract:
        const contractId = `${tx.sender_address}.${tx.parsed_tx.payload.contract_name}`;
        const clarityVersion =
          tx.parsed_tx.payload.type_id == TxPayloadTypeID.VersionedSmartContract
            ? tx.parsed_tx.payload.clarity_version
            : null;
        dbTx.smartContracts.push({
          tx_id: tx.core_tx.txid,
          contract_id: contractId,
          block_height: blockData.block_height,
          clarity_version: clarityVersion,
          source_code: tx.parsed_tx.payload.code_body,
          abi: JSON.stringify(tx.core_tx.contract_abi),
          canonical: true,
        });
        break;
      case TxPayloadTypeID.ContractCall:
        // Name renewals can happen without a zonefile_hash. In that case, the BNS contract does NOT
        // emit a `name-renewal` contract log, causing us to miss this event. This function catches
        // those cases.
        const name = parseNameRenewalWithNoZonefileHashFromContractCall(tx, chainId);
        if (name) {
          dbTx.names.push(name);
        }
        break;
      default:
        break;
    }
    return dbTx;
  });

  const poxEventLogs: Map<DbPoxSyntheticEvent, DbSmartContractEvent> = new Map();

  for (const event of events) {
    if (!event.committed) {
      logger.debug(`Ignoring uncommitted tx event from tx ${event.txid}`);
      continue;
    }
    const dbTx = dbData.find(entry => entry.tx.tx_id === event.txid);
    if (!dbTx) {
      throw new Error(`Unexpected missing tx during event parsing by tx_id ${event.txid}`);
    }

    if (dbTx.tx.status !== DbTxStatus.Success) {
      if (event.type === CoreNodeEventType.ContractEvent) {
        let reprStr = '?';
        try {
          reprStr = decodeClarityValue(event.contract_event.raw_value).repr;
        } catch (e) {
          logger.warn(`Failed to decode contract log event: ${event.contract_event.raw_value}`);
        }
        logger.debug(
          `Ignoring tx event from unsuccessful tx ${event.txid}, status: ${dbTx.tx.status}, repr: ${reprStr}`
        );
      } else {
        logger.debug(
          `Ignoring tx event from unsuccessful tx ${event.txid}, status: ${dbTx.tx.status}`
        );
      }
      continue;
    }

    const dbEvent: DbEventBase = {
      event_index: event.event_index,
      tx_id: event.txid,
      tx_index: dbTx.tx.tx_index,
      block_height: blockData.block_height,
      canonical: true,
    };

    switch (event.type) {
      case CoreNodeEventType.ContractEvent: {
        const entry: DbSmartContractEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.SmartContractLog,
          contract_identifier: event.contract_event.contract_identifier,
          topic: event.contract_event.topic,
          value: event.contract_event.raw_value,
        };
        dbTx.contractLogEvents.push(entry);

        if (isPoxPrintEvent(event)) {
          const network = getChainIDNetwork(chainId) === 'mainnet' ? 'mainnet' : 'testnet';
          const [, contractName] = event.contract_event.contract_identifier.split('.');
          // pox-1 is handled in custom node events
          const processSyntheticEvent = [
            POX_2_CONTRACT_NAME,
            POX_3_CONTRACT_NAME,
            POX_4_CONTRACT_NAME,
          ].includes(contractName);
          if (processSyntheticEvent) {
            const poxEventData = decodePoxSyntheticPrintEvent(
              event.contract_event.raw_value,
              network
            );
            if (poxEventData !== null) {
              logger.debug(`Synthetic pox event data for ${contractName}:`, poxEventData);
              const dbPoxEvent: DbPoxSyntheticEvent = {
                ...dbEvent,
                ...poxEventData,
              };
              poxEventLogs.set(dbPoxEvent, entry);
              switch (contractName) {
                case POX_2_CONTRACT_NAME: {
                  dbTx.pox2Events.push(dbPoxEvent);
                  break;
                }
                case POX_3_CONTRACT_NAME: {
                  dbTx.pox3Events.push(dbPoxEvent);
                  break;
                }
                case POX_4_CONTRACT_NAME: {
                  dbTx.pox4Events.push(dbPoxEvent);
                  break;
                }
              }
            }
          }
        }

        // Check if we have new BNS names or namespaces.
        const parsedTx = parsedTxs.find(entry => entry.core_tx.txid === event.txid);
        if (!parsedTx) {
          throw new Error(`Unexpected missing tx during BNS parsing by tx_id ${event.txid}`);
        }
        const name = parseNameFromContractEvent(
          event,
          parsedTx,
          events,
          blockData.block_height,
          chainId
        );
        if (name) {
          dbTx.names.push(name);
        }
        const namespace = parseNamespaceFromContractEvent(event, parsedTx, blockData.block_height);
        if (namespace) {
          dbTx.namespaces.push(namespace);
        }
        break;
      }
      case CoreNodeEventType.StxLockEvent: {
        const entry: DbStxLockEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.StxLock,
          locked_amount: BigInt(event.stx_lock_event.locked_amount),
          unlock_height: Number(event.stx_lock_event.unlock_height),
          locked_address: event.stx_lock_event.locked_address,
          // if no contract name available, then we can correctly assume pox-v1
          contract_name: event.stx_lock_event.contract_identifier?.split('.')[1] ?? 'pox',
        };
        dbTx.stxLockEvents.push(entry);
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
          memo: event.stx_transfer_event.memo ? '0x' + event.stx_transfer_event.memo : undefined,
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
      case CoreNodeEventType.FtBurnEvent: {
        const entry: DbFtEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.FungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Burn,
          sender: event.ft_burn_event.sender,
          asset_identifier: event.ft_burn_event.asset_identifier,
          amount: BigInt(event.ft_burn_event.amount),
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
          value: event.nft_transfer_event.raw_value,
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
          value: event.nft_mint_event.raw_value,
        };
        dbTx.nftEvents.push(entry);
        break;
      }
      case CoreNodeEventType.NftBurnEvent: {
        const entry: DbNftEvent = {
          ...dbEvent,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Burn,
          sender: event.nft_burn_event.sender,
          asset_identifier: event.nft_burn_event.asset_identifier,
          value: event.nft_burn_event.raw_value,
        };
        dbTx.nftEvents.push(entry);
        break;
      }
      default: {
        throw new Error(`Unexpected CoreNodeEventType: ${inspect(event)}`);
      }
    }
  }

  // Normalize event indexes from per-block to per-transaction contiguous series.
  for (const tx of dbData) {
    const sortedEvents = [
      tx.contractLogEvents,
      tx.ftEvents,
      tx.nftEvents,
      tx.stxEvents,
      tx.stxLockEvents,
    ]
      .flat()
      .sort((a, b) => a.event_index - b.event_index);
    tx.tx.event_count = sortedEvents.length;
    for (let i = 0; i < sortedEvents.length; i++) {
      sortedEvents[i].event_index = i;
    }
    for (const poxEvent of [tx.pox2Events, tx.pox3Events, tx.pox4Events].flat()) {
      const associatedLogEvent = poxEventLogs.get(poxEvent);
      if (!associatedLogEvent) {
        throw new Error(`Missing associated contract log event for pox event ${poxEvent.tx_id}`);
      }
      poxEvent.event_index = associatedLogEvent.event_index;
    }
  }

  return dbData;
}

async function handleNewAttachmentMessage(msg: CoreNodeAttachmentMessage[], db: PgWriteStore) {
  const attachments = msg
    .map(message => {
      if (
        message.contract_id === BnsContractIdentifier.mainnet ||
        message.contract_id === BnsContractIdentifier.testnet
      ) {
        const metadataCV = decodeClarityValue<
          ClarityValueTuple<{
            op: ClarityValueStringAscii;
            name: ClarityValueBuffer;
            namespace: ClarityValueBuffer;
          }>
        >(message.metadata);
        return {
          op: metadataCV.data['op'].data,
          zonefile: message.content.slice(2),
          name: hexToBuffer(metadataCV.data['name'].buffer).toString('utf8'),
          namespace: hexToBuffer(metadataCV.data['namespace'].buffer).toString('utf8'),
          zonefileHash: message.content_hash,
          txId: message.tx_id,
          indexBlockHash: message.index_block_hash,
          blockHeight: Number.parseInt(message.block_height, 10),
        } as DataStoreAttachmentData;
      }
    })
    .filter((msg): msg is DataStoreAttachmentData => !!msg);
  await db.updateAttachments(attachments);
}

export const DummyEventMessageHandler: EventMessageHandler = {
  handleRawEventRequest: () => {},
  handleBlockMessage: () => {},
  handleMicroblockMessage: () => {},
  handleBurnBlock: () => {},
  handleMempoolTxs: () => {},
  handleDroppedMempoolTxs: () => {},
  handleNewAttachment: () => {},
};

interface EventMessageHandler {
  handleRawEventRequest(eventPath: string, payload: any, db: PgWriteStore): Promise<void> | void;
  handleBlockMessage(
    chainId: ChainID,
    msg: CoreNodeBlockMessage,
    db: PgWriteStore
  ): Promise<void> | void;
  handleMicroblockMessage(
    chainId: ChainID,
    msg: CoreNodeMicroblockMessage,
    db: PgWriteStore
  ): Promise<void> | void;
  handleMempoolTxs(rawTxs: string[], db: PgWriteStore): Promise<void> | void;
  handleBurnBlock(msg: CoreNodeBurnBlockMessage, db: PgWriteStore): Promise<void> | void;
  handleDroppedMempoolTxs(
    msg: CoreNodeDropMempoolTxMessage,
    db: PgWriteStore
  ): Promise<void> | void;
  handleNewAttachment(msg: CoreNodeAttachmentMessage[], db: PgWriteStore): Promise<void> | void;
}

function createMessageProcessorQueue(): EventMessageHandler {
  // Create a promise queue so that only one message is handled at a time.
  const processorQueue = new PQueue({ concurrency: 1 });

  let eventTimer: prom.Histogram<'event'> | undefined;
  if (isProdEnv) {
    eventTimer = new prom.Histogram({
      name: 'stacks_event_ingestion_timers',
      help: 'Event ingestion timers',
      labelNames: ['event'],
      buckets: prom.exponentialBuckets(50, 3, 10), // 10 buckets, from 50 ms to 15 minutes
    });
  }

  const observeEvent = async (event: string, fn: () => Promise<void>) => {
    const timer = stopwatch();
    try {
      await fn();
    } finally {
      const elapsedMs = timer.getElapsed();
      eventTimer?.observe({ event }, elapsedMs);
    }
  };

  const handler: EventMessageHandler = {
    handleRawEventRequest: (eventPath: string, payload: any, db: PgWriteStore) => {
      return processorQueue
        .add(() => observeEvent('raw_event', () => handleRawEventRequest(eventPath, payload, db)))
        .catch(e => {
          logger.error(e, 'Error storing raw core node request data');
          throw e;
        });
    },
    handleBlockMessage: (chainId: ChainID, msg: CoreNodeBlockMessage, db: PgWriteStore) => {
      return processorQueue
        .add(() => observeEvent('block', () => handleBlockMessage(chainId, msg, db)))
        .catch(e => {
          logger.error(e, 'Error processing core node block message');
          throw e;
        });
    },
    handleMicroblockMessage: (
      chainId: ChainID,
      msg: CoreNodeMicroblockMessage,
      db: PgWriteStore
    ) => {
      return processorQueue
        .add(() => observeEvent('microblock', () => handleMicroblockMessage(chainId, msg, db)))
        .catch(e => {
          logger.error(e, 'Error processing core node microblock message');
          throw e;
        });
    },
    handleBurnBlock: (msg: CoreNodeBurnBlockMessage, db: PgWriteStore) => {
      return processorQueue
        .add(() => observeEvent('burn_block', () => handleBurnBlockMessage(msg, db)))
        .catch(e => {
          logger.error(e, 'Error processing core node burn block message');
          throw e;
        });
    },
    handleMempoolTxs: (rawTxs: string[], db: PgWriteStore) => {
      return processorQueue
        .add(() => observeEvent('mempool_txs', () => handleMempoolTxsMessage(rawTxs, db)))
        .catch(e => {
          logger.error(e, 'Error processing core node mempool message');
          throw e;
        });
    },
    handleDroppedMempoolTxs: (msg: CoreNodeDropMempoolTxMessage, db: PgWriteStore) => {
      return processorQueue
        .add(() =>
          observeEvent('dropped_mempool_txs', () => handleDroppedMempoolTxsMessage(msg, db))
        )
        .catch(e => {
          logger.error(e, 'Error processing core node dropped mempool txs message');
          throw e;
        });
    },
    handleNewAttachment: (msg: CoreNodeAttachmentMessage[], db: PgWriteStore) => {
      return processorQueue
        .add(() => observeEvent('new_attachment', () => handleNewAttachmentMessage(msg, db)))
        .catch(e => {
          logger.error(e, 'Error processing new attachment message');
          throw e;
        });
    },
  };

  return handler;
}

export type EventStreamServer = net.Server & {
  serverAddress: net.AddressInfo;
  closeAsync: () => Promise<void>;
};

export async function startEventServer(opts: {
  datastore: PgWriteStore;
  chainId: ChainID;
  messageHandler?: EventMessageHandler;
  /** If not specified, this is read from the STACKS_CORE_EVENT_HOST env var. */
  serverHost?: string;
  /** If not specified, this is read from the STACKS_CORE_EVENT_PORT env var. */
  serverPort?: number;
}): Promise<EventStreamServer> {
  const db = opts.datastore;
  const messageHandler = opts.messageHandler ?? createMessageProcessorQueue();

  let eventHost = opts.serverHost ?? process.env['STACKS_CORE_EVENT_HOST'];
  const eventPort = opts.serverPort ?? parseInt(process.env['STACKS_CORE_EVENT_PORT'] ?? '', 10);
  if (!eventHost) {
    throw new Error(
      `STACKS_CORE_EVENT_HOST must be specified, e.g. "STACKS_CORE_EVENT_HOST=127.0.0.1"`
    );
  }
  if (!Number.isInteger(eventPort)) {
    throw new Error(`STACKS_CORE_EVENT_PORT must be specified, e.g. "STACKS_CORE_EVENT_PORT=3700"`);
  }

  if (eventHost.startsWith('http:')) {
    const { hostname } = new URL(eventHost);
    eventHost = hostname;
  }

  const bodyLimit = 1_000_000 * 500; // 500MB body limit

  const reqLogSerializer = (req: FastifyRequest) => ({
    method: req.method,
    url: req.url,
    version: req.headers?.['accept-version'] as string,
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
    bodySize: parseInt(req.headers?.['content-length'] as string) || 'unknown',
  });

  const loggerOpts: FastifyServerOptions['logger'] = {
    ...PINO_LOGGER_CONFIG,
    name: 'stacks-node-event',
    serializers: {
      req: reqLogSerializer,
      res: reply => ({
        statusCode: reply.statusCode,
        method: reply.request?.method,
        url: reply.request?.url,
        requestBodySize: parseInt(reply.request?.headers['content-length'] as string) || 'unknown',
        responseBodySize: parseInt(reply.getHeader?.('content-length') as string) || 'unknown',
      }),
    },
  };

  const app = Fastify({
    bodyLimit,
    trustProxy: true,
    logger: loggerOpts,
    ignoreTrailingSlash: true,
  });

  app.addHook('onRequest', (req, reply, done) => {
    req.raw.on('close', () => {
      if (req.raw.aborted) {
        req.log.warn(
          reqLogSerializer(req),
          `Request was aborted by the client: ${req.method} ${req.url}`
        );
      }
    });
    done();
  });

  const handleRawEventRequest = async (req: FastifyRequest) => {
    await messageHandler.handleRawEventRequest(req.url, req.body, db);

    if (logger.level === 'debug') {
      let payload = JSON.stringify(req.body);
      // Skip logging massive event payloads, this _should_ only exclude the genesis block payload which is ~80 MB.
      if (payload.length > 10_000_000) {
        payload = 'payload body too large for logging';
      }
      logger.debug(`${req.url} ${payload}`, { component: 'stacks-node-event' });
    }
  };

  const ibdHeight = getIbdBlockHeight();
  if (ibdHeight) {
    app.addHook('preHandler', async (req, res) => {
      if (IBD_PRUNABLE_ROUTES.includes(req.url)) {
        try {
          const chainTip = await db.getChainTip(db.sql);
          if (chainTip.block_height <= ibdHeight) {
            await handleRawEventRequest(req);
            await res.status(200).send(`IBD`);
          }
        } catch (error) {
          await res
            .status(500)
            .send({ message: 'A middleware error occurred processing the request in IBD mode.' });
        }
      }
    });
  }

  app.get('/', async (_req, res) => {
    await res
      .status(200)
      .send({ status: 'ready', msg: 'API event server listening for core-node POST messages' });
  });

  app.post('/new_block', async (req, res) => {
    try {
      const blockMessage = req.body as CoreNodeBlockMessage;
      await messageHandler.handleBlockMessage(opts.chainId, blockMessage, db);
      if (blockMessage.block_height === 1) {
        await handleBnsImport(db);
      }
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_block');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/new_burn_block', async (req, res) => {
    try {
      const msg = req.body as CoreNodeBurnBlockMessage;
      await messageHandler.handleBurnBlock(msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_burn_block');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/new_mempool_tx', async (req, res) => {
    try {
      const rawTxs = req.body as string[];
      await messageHandler.handleMempoolTxs(rawTxs, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_mempool_tx');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/drop_mempool_tx', async (req, res) => {
    try {
      const msg = req.body as CoreNodeDropMempoolTxMessage;
      await messageHandler.handleDroppedMempoolTxs(msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /drop_mempool_tx');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/attachments/new', async (req, res) => {
    try {
      const msg = req.body as CoreNodeAttachmentMessage[];
      await messageHandler.handleNewAttachment(msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /attachments/new');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/new_microblocks', async (req, res) => {
    try {
      const msg = req.body as CoreNodeMicroblockMessage;
      await messageHandler.handleMicroblockMessage(opts.chainId, msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_microblocks');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/stackerdb_chunks', async (req, res) => {
    try {
      await handleRawEventRequest(req);
      if (isProdEnv) {
        logger.warn(
          'Received stackerdb_chunks message -- event not required for API operations and can cause db bloat and performance degradation in production'
        );
      }
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /stackerdb_chunks');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/proposal_response', async (req, res) => {
    try {
      await handleRawEventRequest(req);
      if (isProdEnv) {
        logger.warn(
          'Received proposal_response message -- event not required for API operations and can cause db bloat and performance degradation in production'
        );
      }
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /proposal_response');
      await res.status(500).send({ error: error });
    }
  });

  app.post('*', async (req, res) => {
    await res.status(404).send({ error: `no route handler for ${req.url}` });
    logger.error(`Unexpected event on path ${req.url}`);
  });

  const addr = await app.listen({ port: eventPort, host: eventHost });
  logger.info(`Event observer listening at: ${addr}`);

  const closeFn = async () => {
    logger.info('Closing event observer server...');
    await app.close();
  };
  const eventStreamServer: EventStreamServer = Object.assign(app.server, {
    serverAddress: app.addresses()[0],
    closeAsync: closeFn,
  });
  return eventStreamServer;
}

export function parseNewBlockMessage(
  chainId: ChainID,
  msg: CoreNodeBlockMessage,
  isEventReplay: boolean
) {
  const counts = newCoreNoreBlockEventCounts();

  const parsedTxs: CoreNodeParsedTxMessage[] = [];
  const blockData: CoreNodeMsgBlockData = {
    ...msg,
  };

  if (!blockData.block_time) {
    // If running in IBD mode, we use the parent burn block timestamp as the receipt date,
    // otherwise, use the current timestamp.
    const stacksBlockReceiptDate = isEventReplay
      ? msg.burn_block_time
      : Math.round(Date.now() / 1000);
    blockData.block_time = stacksBlockReceiptDate;
  }

  msg.transactions.forEach(item => {
    const parsedTx = parseMessageTransaction(chainId, item, blockData, msg.events);
    if (parsedTx) {
      parsedTxs.push(parsedTx);
      counts.tx_total += 1;
      switch (parsedTx.parsed_tx.payload.type_id) {
        case TxPayloadTypeID.Coinbase:
          counts.txs.coinbase += 1;
          break;
        case TxPayloadTypeID.CoinbaseToAltRecipient:
          counts.txs.coinbase_to_alt_recipient += 1;
          break;
        case TxPayloadTypeID.ContractCall:
          counts.txs.contract_call += 1;
          break;
        case TxPayloadTypeID.NakamotoCoinbase:
          counts.txs.nakamoto_coinbase += 1;
          break;
        case TxPayloadTypeID.PoisonMicroblock:
          counts.txs.poison_microblock += 1;
          break;
        case TxPayloadTypeID.SmartContract:
          counts.txs.smart_contract += 1;
          break;
        case TxPayloadTypeID.TenureChange:
          counts.txs.tenure_change += 1;
          break;
        case TxPayloadTypeID.TokenTransfer:
          counts.txs.token_transfer += 1;
          break;
        case TxPayloadTypeID.VersionedSmartContract:
          counts.txs.versioned_smart_contract += 1;
          break;
      }
    }
  });
  for (const event of msg.events) {
    counts.event_total += 1;
    counts.events[event.type] += 1;
  }

  const signerBitvec = msg.signer_bitvec
    ? BitVec.consensusDeserializeToString(msg.signer_bitvec)
    : null;

  // Stacks-core does not include the '0x' prefix in the signer signature hex strings
  const signerSignatures =
    msg.signer_signature?.map(s => (s.startsWith('0x') ? s : '0x' + s)) ?? null;

  // `anchored_cost` is not available in very old versions of stacks-core
  const execCost =
    msg.anchored_cost ??
    parsedTxs.reduce(
      (acc, { core_tx: { execution_cost } }) => ({
        read_count: acc.read_count + execution_cost.read_count,
        read_length: acc.read_length + execution_cost.read_length,
        runtime: acc.runtime + execution_cost.runtime,
        write_count: acc.write_count + execution_cost.write_count,
        write_length: acc.write_length + execution_cost.write_length,
      }),
      {
        read_count: 0,
        read_length: 0,
        runtime: 0,
        write_count: 0,
        write_length: 0,
      }
    );

  if (typeof msg.tenure_height !== 'number' && msg.signer_bitvec) {
    logger.warn(
      `Nakamoto block ${msg.block_height} event payload has no tenure_height. Use stacks-core version 3.0.0.0.0-rc6 or newer!`
    );
  }

  const dbBlock: DbBlock = {
    canonical: true,
    block_hash: msg.block_hash,
    index_block_hash: msg.index_block_hash,
    parent_index_block_hash: msg.parent_index_block_hash,
    parent_block_hash: msg.parent_block_hash,
    parent_microblock_hash: msg.parent_microblock,
    parent_microblock_sequence: msg.parent_microblock_sequence,
    block_height: msg.block_height,
    burn_block_time: msg.burn_block_time,
    burn_block_hash: msg.burn_block_hash,
    burn_block_height: msg.burn_block_height,
    miner_txid: msg.miner_txid,
    execution_cost_read_count: execCost.read_count,
    execution_cost_read_length: execCost.read_length,
    execution_cost_runtime: execCost.runtime,
    execution_cost_write_count: execCost.write_count,
    execution_cost_write_length: execCost.write_length,
    tx_count: msg.transactions.length,
    block_time: blockData.block_time,
    signer_bitvec: signerBitvec,
    signer_signatures: signerSignatures,
    tenure_height: msg.tenure_height ?? null,
  };

  logger.debug(`Received block ${msg.block_hash} (${msg.block_height}) from node`, dbBlock);

  const dbMinerRewards: DbMinerReward[] = [];
  for (const minerReward of msg.matured_miner_rewards) {
    const dbMinerReward: DbMinerReward = {
      canonical: true,
      block_hash: minerReward.from_stacks_block_hash,
      index_block_hash: msg.index_block_hash,
      from_index_block_hash: minerReward.from_index_consensus_hash,
      mature_block_height: msg.block_height,
      recipient: minerReward.recipient,
      // If `miner_address` is null then it means pre-Stacks2.1 data, and the `recipient` can be accurately used
      miner_address: minerReward.miner_address ?? minerReward.recipient,
      coinbase_amount: BigInt(minerReward.coinbase_amount),
      tx_fees_anchored: BigInt(minerReward.tx_fees_anchored),
      tx_fees_streamed_confirmed: BigInt(minerReward.tx_fees_streamed_confirmed),
      tx_fees_streamed_produced: BigInt(minerReward.tx_fees_streamed_produced),
    };
    dbMinerRewards.push(dbMinerReward);
    counts.miner_rewards += 1;
  }

  logger.debug(`Received ${dbMinerRewards.length} matured miner rewards`);

  const dbMicroblocks = parseMicroblocksFromTxs({
    parentIndexBlockHash: msg.parent_index_block_hash,
    txs: msg.transactions,
    parentBurnBlock: {
      height: msg.parent_burn_block_height,
      hash: msg.parent_burn_block_hash,
      time: msg.parent_burn_block_timestamp,
    },
  }).map(mb => {
    const microblock: DbMicroblock = {
      ...mb,
      canonical: true,
      microblock_canonical: true,
      block_height: msg.block_height,
      parent_block_height: msg.block_height - 1,
      parent_block_hash: msg.parent_block_hash,
      index_block_hash: msg.index_block_hash,
      block_hash: msg.block_hash,
    };
    counts.microblocks += 1;
    return microblock;
  });

  let poxSetSigners: DbPoxSetSigners | undefined;
  if (msg.reward_set) {
    assertNotNullish(
      msg.cycle_number,
      () => 'Cycle number must be present if reward set is present'
    );
    let signers: DbPoxSetSigners['signers'] = [];
    if (msg.reward_set.signers) {
      signers = msg.reward_set.signers.map(signer => ({
        signing_key: '0x' + signer.signing_key,
        weight: signer.weight,
        stacked_amount: BigInt(signer.stacked_amt),
      }));
      logger.info(
        `Received new pox set message, block=${msg.block_height}, cycle=${msg.cycle_number}, signers=${msg.reward_set.signers.length}`
      );
    }
    let rewardedAddresses: string[] = [];
    if (msg.reward_set.rewarded_addresses) {
      rewardedAddresses = msg.reward_set.rewarded_addresses;
      logger.info(
        `Received new pox set message, ${rewardedAddresses.length} rewarded BTC addresses`
      );
    }
    poxSetSigners = {
      cycle_number: msg.cycle_number,
      pox_ustx_threshold: BigInt(msg.reward_set.pox_ustx_threshold),
      signers,
      rewarded_addresses: rewardedAddresses,
    };
  }

  const dbData: DataStoreBlockUpdateData = {
    block: dbBlock,
    microblocks: dbMicroblocks,
    minerRewards: dbMinerRewards,
    txs: parseDataStoreTxEventData(parsedTxs, msg.events, dbBlock, chainId),
    pox_v1_unlock_height: msg.pox_v1_unlock_height,
    pox_v2_unlock_height: msg.pox_v2_unlock_height,
    pox_v3_unlock_height: msg.pox_v3_unlock_height,
    poxSetSigners: poxSetSigners,
  };

  return { dbData, counts };
}

export function parseAttachment(msg: CoreNodeAttachmentMessage[]) {
  const zoneFiles: { zonefile: string; zonefileHash: string; txId: string }[] = [];
  const subdomains: DbBnsSubdomain[] = [];
  for (const attachment of msg) {
    if (
      attachment.contract_id === BnsContractIdentifier.mainnet ||
      attachment.contract_id === BnsContractIdentifier.testnet
    ) {
      const metadataCV = decodeClarityValue<
        ClarityValueTuple<{
          op: ClarityValueStringAscii;
          name: ClarityValueBuffer;
          namespace: ClarityValueBuffer;
        }>
      >(attachment.metadata);
      const op = metadataCV.data['op'].data;
      const zonefile = Buffer.from(attachment.content.slice(2), 'hex').toString();
      const zonefileHash = attachment.content_hash;
      zoneFiles.push({
        zonefile,
        zonefileHash,
        txId: attachment.tx_id,
      });
      if (op === 'name-update') {
        const name = hexToBuffer(metadataCV.data['name'].buffer).toString('utf8');
        const namespace = hexToBuffer(metadataCV.data['namespace'].buffer).toString('utf8');
        const zoneFileContents = zoneFileParser.parseZoneFile(zonefile);
        const zoneFileTxt = zoneFileContents.txt;
        // Case for subdomain
        if (zoneFileTxt) {
          for (let i = 0; i < zoneFileTxt.length; i++) {
            const zoneFile = zoneFileTxt[i];
            const parsedTxt = parseZoneFileTxt(zoneFile.txt);
            if (parsedTxt.owner === '') continue; //if txt has no owner , skip it
            const subdomain: DbBnsSubdomain = {
              name: name.concat('.', namespace),
              namespace_id: namespace,
              fully_qualified_subdomain: zoneFile.name.concat('.', name, '.', namespace),
              owner: parsedTxt.owner,
              zonefile_hash: parsedTxt.zoneFileHash,
              zonefile: parsedTxt.zoneFile,
              tx_id: attachment.tx_id,
              tx_index: -1,
              canonical: true,
              parent_zonefile_hash: attachment.content_hash.slice(2),
              parent_zonefile_index: 0, // TODO need to figure out this field
              block_height: Number.parseInt(attachment.block_height, 10),
              zonefile_offset: 1,
              resolver: zoneFileContents.uri ? parseResolver(zoneFileContents.uri) : '',
              index_block_hash: attachment.index_block_hash,
            };
            subdomains.push(subdomain);
          }
        }
      }
    }
  }
  return { zoneFiles, subdomains };
}
