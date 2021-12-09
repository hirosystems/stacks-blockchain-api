// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as whyIsNodeRunning from 'why-is-node-running';

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

  let whyRunInterval = 1000;
  setInterval(() => {
    console.log('\n\n\n\n_____WHY IS NODE RUNNING_____');
    whyIsNodeRunning();
  }, (whyRunInterval *= 2)).unref();
};
