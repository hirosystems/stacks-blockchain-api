import { logError, logger } from './helpers';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export type ShutdownHandler = () => void | PromiseLike<void>;

const shutdownHandlers: ShutdownHandler[] = [];

export let isShuttingDown = false;

async function startShutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  let errorEncountered = false;
  for (const handler of shutdownHandlers) {
    try {
      await Promise.resolve(handler());
    } catch (error) {
      errorEncountered = true;
      logError('Error running shutdown handler', error);
    }
  }
  if (errorEncountered) {
    process.exit(1);
  } else {
    logger.info('App shutdown successful.');
    process.exit();
  }
}

let shutdownSignalsRegistered = false;
function registerShutdownSignals() {
  if (shutdownSignalsRegistered) {
    return;
  }
  shutdownSignalsRegistered = true;

  SHUTDOWN_SIGNALS.forEach(sig => {
    process.once(sig, () => {
      logger.warn(`Shutting down... received signal: ${sig}`);
      void startShutdown();
    });
  });
  process.once('unhandledRejection', error => {
    logError(`unhandledRejection ${(error as any)?.message ?? error}`, error as Error);
    logger.error(`Shutting down... received unhandledRejection.`);
    void startShutdown();
  });
  process.once('uncaughtException', error => {
    logError(`Received uncaughtException: ${error}`, error);
    logger.error(`Shutting down... received uncaughtException.`);
    void startShutdown();
  });
  process.once('beforeExit', () => {
    logger.warn(`Shutting down... received beforeExit.`);
    void startShutdown();
  });
}

export function registerShutdownHandler(...handlers: ShutdownHandler[]) {
  registerShutdownSignals();
  shutdownHandlers.push(...handlers);
}
