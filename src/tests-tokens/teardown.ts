import type { GlobalServices } from './setup';

export default async (): Promise<void> => {
  console.log('Jest - teardown..');
  const globalServices = (global as unknown) as GlobalServices;
  await globalServices.db.close();
  console.log('Jest - teardown done');
};
