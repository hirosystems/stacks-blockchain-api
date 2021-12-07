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
};
