process.on(
  'message',
  async ({ db, bnsDir, bnsGenesisBlock, importV1BnsNames, importV1BnsSubdomains, logger }) => {
    console.log('Message from parent:', { db, bnsDir, bnsGenesisBlock });
    logger.verbose('Starting V1 BNS names import');
    await importV1BnsNames(db, bnsDir, bnsGenesisBlock);
    logger.verbose('Starting V1 BNS subdomains import');
    await importV1BnsSubdomains(db, bnsDir, bnsGenesisBlock);
  }
);

// let counter = 0;

// setInterval(() => {
//   process.send({ counter: counter++ });
// }, 1000);
