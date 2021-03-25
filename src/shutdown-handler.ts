import { logger } from './helpers';

const SHUTDOWN_SIGNALS = [
  'beforeExit',
  'uncaughtException',
  'unhandledRejection',
  'SIGINT',
  'SIGTERM',
];

export type ShutdownHandler = () => void | PromiseLike<void>;

const shutdownHandlers: ShutdownHandler[] = [];

let shutdownSignalsRegistered = false;
function registerShutdownSignals() {
  if (shutdownSignalsRegistered) {
    return;
  }
  shutdownSignalsRegistered = true;
  let runHandlers: undefined | (() => Promise<never>) = async () => {
    let errorEncountered = false;
    for (const handler of shutdownHandlers) {
      try {
        await Promise.resolve(handler());
      } catch (error) {
        errorEncountered = true;
        logger.error('Error running shutdown handler', error);
      }
    }
    if (errorEncountered) {
      process.exit(1);
    } else {
      process.exit();
    }
  };

  SHUTDOWN_SIGNALS.forEach(sig => {
    process.once(sig as any, () => {
      logger.warn(`Shutting down... received signal: ${sig}`);
      void runHandlers?.();
      runHandlers = undefined;
    });
  });
}

export function registerShutdownHandler(...handlers: ShutdownHandler[]) {
  registerShutdownSignals();
  shutdownHandlers.push(...handlers);
}
