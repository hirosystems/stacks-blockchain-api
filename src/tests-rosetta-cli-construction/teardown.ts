import type { GlobalServices } from './setup';
// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - teardown..');
  const globalServices = global as unknown as GlobalServices;
  await globalServices.db.close();
  console.log('Jest - teardown done');
};
