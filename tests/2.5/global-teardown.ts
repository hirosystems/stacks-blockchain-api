import type { GlobalTestEnv } from './global-setup';

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - global teardown..');
  const testEnv: GlobalTestEnv = (global as any).globalTestEnv;

  await testEnv.eventServer.closeAsync();
  await testEnv.db.close({ timeout: 0 });

  console.log('Jest - global teardown done');
};
