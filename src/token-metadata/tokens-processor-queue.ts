import { logError, logger } from '../helpers';
import { Evt } from 'evt';
import PQueue from 'p-queue';
import { DbTokenMetadataQueueEntry, TokenMetadataUpdateInfo } from '../datastore/common';
import { ChainID, ClarityAbi } from '@stacks/transactions';
import { TokensContractHandler } from './tokens-contract-handler';
import { PgWriteStore } from '../datastore/pg-write-store';

/**
 * The maximum number of token metadata parsing operations that can be ran concurrently before
 * being added to a FIFO queue.
 */
const TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT = 5;

export class TokensProcessorQueue {
  readonly queue: PQueue;
  readonly db: PgWriteStore;
  readonly chainId: ChainID;

  readonly processStartedEvent: Evt<{
    contractId: string;
    txId: string;
  }> = new Evt();

  readonly processEndEvent: Evt<{
    contractId: string;
    txId: string;
  }> = new Evt();

  /** The entries currently queued for processing in memory, keyed by the queue entry db id. */
  readonly queuedEntries: Map<number, TokenMetadataUpdateInfo> = new Map();

  readonly onTokenMetadataUpdateQueued: (queueId: number) => void;
  readonly onBlockUpdate: (blockHash: string) => void;

  constructor(db: PgWriteStore, chainId: ChainID) {
    this.db = db;
    this.chainId = chainId;
    this.queue = new PQueue({ concurrency: TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT });
    this.onTokenMetadataUpdateQueued = entry => this.queueNotificationHandler(entry);
    this.db.eventEmitter.on('tokenMetadataUpdateQueued', this.onTokenMetadataUpdateQueued);
    this.onBlockUpdate = blockHash => this.blockNotificationHandler(blockHash);
    this.db.eventEmitter.on('blockUpdate', this.onBlockUpdate);
  }

  close() {
    this.db.eventEmitter.off('tokenMetadataUpdateQueued', this.onTokenMetadataUpdateQueued);
    this.db.eventEmitter.off('blockUpdate', this.onBlockUpdate);
    this.queue.pause();
    this.queue.clear();
  }

  async drainDbQueue(): Promise<void> {
    let entries: DbTokenMetadataQueueEntry[] = [];
    do {
      if (this.queue.isPaused) {
        return;
      }
      const queuedEntries = [...this.queuedEntries.keys()];
      entries = await this.db.getTokenMetadataQueue(
        TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT,
        queuedEntries
      );
      for (const entry of entries) {
        await this.queueHandler(entry);
      }
      await this.queue.onEmpty();
      // await this.queue.onIdle();
    } while (entries.length > 0 || this.queuedEntries.size > 0);
  }

  async checkDbQueue(): Promise<void> {
    if (this.queue.isPaused) {
      return;
    }
    const queuedEntries = [...this.queuedEntries.keys()];
    const limit = TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT - this.queuedEntries.size;
    if (limit > 0) {
      const entries = await this.db.getTokenMetadataQueue(
        TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT,
        queuedEntries
      );
      for (const entry of entries) {
        await this.queueHandler(entry);
      }
    }
  }

  async queueNotificationHandler(queueId: number) {
    const queueEntry = await this.db.getTokenMetadataQueueEntry(queueId);
    if (queueEntry.found) {
      await this.queueHandler(queueEntry.result);
    }
  }

  async blockNotificationHandler(_: string) {
    // Every block, check if we have entries we still need to process.
    await this.drainDbQueue();
  }

  async queueHandler(queueEntry: TokenMetadataUpdateInfo) {
    if (
      this.queuedEntries.has(queueEntry.queueId) ||
      this.queuedEntries.size >= this.queue.concurrency
    ) {
      return;
    }
    const contractQuery = await this.db.getSmartContract(queueEntry.contractId);
    if (!contractQuery.found || !contractQuery.result.abi) {
      return;
    }
    logger.info(
      `[token-metadata] queueing token contract for processing: ${queueEntry.contractId} from tx ${queueEntry.txId}`
    );
    this.queuedEntries.set(queueEntry.queueId, queueEntry);

    const contractAbi: ClarityAbi = JSON.parse(contractQuery.result.abi);

    const tokenContractHandler = new TokensContractHandler({
      contractId: queueEntry.contractId,
      smartContractAbi: contractAbi,
      datastore: this.db,
      chainId: this.chainId,
      txId: queueEntry.txId,
      dbQueueId: queueEntry.queueId,
    });

    void this.queue
      .add(async () => {
        this.processStartedEvent.post({
          contractId: queueEntry.contractId,
          txId: queueEntry.txId,
        });
        await tokenContractHandler.start();
      })
      .catch(error => {
        logError(
          `[token-metadata] error processing token contract: ${tokenContractHandler.contractAddress} ${tokenContractHandler.contractName} from tx ${tokenContractHandler.txId}`,
          error
        );
      })
      .finally(() => {
        this.queuedEntries.delete(queueEntry.queueId);
        this.processEndEvent.post({
          contractId: queueEntry.contractId,
          txId: queueEntry.txId,
        });
        if (this.queuedEntries.size < this.queue.concurrency) {
          void this.checkDbQueue();
        }
      });
  }
}
