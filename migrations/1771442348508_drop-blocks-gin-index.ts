import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.dropIndex('blocks', 'signer_signatures', { ifExists: true });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.createIndex('blocks', 'signer_signatures', { ifNotExists: true, method: 'gin' });
};
