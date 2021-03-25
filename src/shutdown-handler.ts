import { logError, logger } from './helpers';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export type ShutdownHandler = () => void | PromiseLike<void>;

const shutdownHandlers: ShutdownHandler[] = [];

let shutdownSignalsRegistered = false;
function registerShutdownSignals() {
  if (shutdownSignalsRegistered) {
    return;
  }
  shutdownSignalsRegistered = true;
  let runHandlers: undefined | (() => Promise<never>) = async () => {
    runHandlers = undefined;
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
      process.exit();
    }
  };

  SHUTDOWN_SIGNALS.forEach(sig => {
    process.once(sig, () => {
      logger.warn(`Shutting down... received signal: ${sig}`);
      void runHandlers?.();
    });
  });
  process.once('unhandledRejection', error => {
    // TODO: This should be enabled in a standalone update, as it may cause previously ignored non-critical errors to exit the program.
    // In the meantime, log the error without propagated it to uncaughtException.
    // throw error;
    logError(`unhandledRejection ${(error as any)?.message ?? error}`, error as Error);
  });
  process.once('uncaughtException', () => {
    logger.warn(`Shutting down... received uncaughtException`);
    void runHandlers?.();
  });
  process.once('beforeExit', () => {
    logger.warn(`Shutting down... received beforeExit`);
    void runHandlers?.();
  });
}

export function registerShutdownHandler(...handlers: ShutdownHandler[]) {
  registerShutdownSignals();
  shutdownHandlers.push(...handlers);
}
