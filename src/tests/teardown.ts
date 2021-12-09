import * as isCI from 'is-ci';

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - teardown..');
  const eventSocketServer: import('net').Server = (global as any).server;
  await new Promise<void>(resolve => {
    eventSocketServer.close(() => {
      console.log('Jest - teardown done');
      resolve();
    });
  });

  // If running in CI setup the "why am I still running?" log to detect stuck Jest tests
  if (isCI) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const whyIsNodeRunning = require('why-is-node-running');
    let whyRunInterval = 1000;
    setInterval(() => {
      console.log('\n\n\n\n_____WHY IS NODE RUNNING_____');
      whyIsNodeRunning();
    }, (whyRunInterval *= 2)).unref();
  }
};
