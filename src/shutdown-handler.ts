import { logger } from './helpers';

const SHUTDOWN_SIGNALS = [
  'beforeExit',
  'uncaughtException',
  'unhandledRejection',
  'SIGINT',
  'SIGTERM',
];

export type ShutdownHandler = () => void | PromiseLike<void>;

export function registerShutdownHandler(...handlers: ShutdownHandler[]) {
  let runHandlers: undefined | (() => Promise<never>) = async () => {
    let errorEncountered = false;
    for (const handler of handlers) {
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
