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
  const runHandlers = async () => {
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
    process.on(sig as any, () => {
      logger.warn(`Received shutdown signal: ${sig}`);
      void runHandlers();
    });
  });
}
