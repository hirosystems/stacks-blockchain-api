import { ChainID } from '@stacks/transactions';
import { ApiServer, startApiServer } from '../../src/api/init';
import { httpPostRequest } from '../../src/helpers';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../utils/test-builders';

describe('api event-server tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;
  let apiServer: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;

    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Mainnet,
      serverHost: '127.0.0.1',
      serverPort: 0,
    });
    apiServer = await startApiServer({
      datastore: db,
      chainId: ChainID.Mainnet,
    });
  });

  afterEach(async () => {
    await apiServer.terminate();
    await eventServer.closeAsync();
    await db?.close();
    await migrate('down');
  });

  test('total block execution cost', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x29fe7ba9674b9196fefa28764a35a4603065dc25c9dcf83c56648066f36a8dce',
      burn_block_height: 749661,
      burn_block_hash: '0x000000000000000000021e9777470811a937006cf47efceadefca2e8031c4b5f',
      burn_block_time: 1660638853,
    })
      .addTx()
      .build();
    await db.update(block);
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x8455c986ef89d09968b96fee0ef5b4625aa3860aa68e70123efa129f48e55c6b',
        microblock_sequence: 0,
        parent_index_block_hash:
          '0x29fe7ba9674b9196fefa28764a35a4603065dc25c9dcf83c56648066f36a8dce',
      })
      .build();
    await db.updateMicroblocks(microblock);
    const payload = {
      events: [
        {
          txid: '0x2c4ea25277a45787ddc4f22c3b0960680f5df89abfe1b4536587378fce891d52',
          type: 'stx_lock_event',
          committed: true,
          event_index: 6,
          stx_lock_event: {
            locked_amount: '1375080000000000',
            unlock_height: '180',
            locked_address: 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP',
            contract_identifier: 'ST000000000000000000002AMW42H.pox-4',
          },
        },
        {
          txid: '0x52293f29d4896f57011cef4b63afb936905e6d6fc55d7490e89b2711e4b2e6f7',
          type: 'stx_lock_event',
          committed: true,
          event_index: 2,
          stx_lock_event: {
            locked_amount: '4125240000000000',
            unlock_height: '180',
            locked_address: 'ST3AM1A56AK2C1XAFJ4115ZSV26EB49BVQ10MGCS0',
            contract_identifier: 'ST000000000000000000002AMW42H.pox-4',
          },
        },
        {
          txid: '0xf5f637dfa7de14fbac5710b6db1367261acc3718281180977d662deed0f3682a',
          type: 'stx_transfer_event',
          committed: true,
          event_index: 0,
          stx_transfer_event: {
            memo: '00000000000000000000000000000000000000000000000000000000000000000000',
            amount: '1000',
            sender: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
            recipient: 'ST29V10QEA7BRZBTWRFC4M70NJ4J6RJB5P1C6EE84',
          },
        },
        {
          txid: '0x52293f29d4896f57011cef4b63afb936905e6d6fc55d7490e89b2711e4b2e6f7',
          type: 'contract_event',
          committed: true,
          event_index: 1,
          contract_event: {
            topic: 'print',
            value: {
              Response: {
                data: {
                  Tuple: {
                    data_map: {
                      data: {
                        Tuple: {
                          data_map: {
                            'auth-id': {
                              UInt: 218617921465875,
                            },
                            'pox-addr': {
                              Tuple: {
                                data_map: {
                                  version: {
                                    Sequence: {
                                      Buffer: {
                                        data: [0],
                                      },
                                    },
                                  },
                                  hashbytes: {
                                    Sequence: {
                                      Buffer: {
                                        data: [
                                          213, 64, 168, 166, 84, 196, 192, 245, 79, 145, 2, 18, 255,
                                          59, 17, 156, 178, 37, 123, 184,
                                        ],
                                      },
                                    },
                                  },
                                },
                                type_signature: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                            },
                            'max-amount': {
                              UInt: 3.402823669209385e38,
                            },
                            'signer-key': {
                              Sequence: {
                                Buffer: {
                                  data: [
                                    2, 142, 250, 32, 250, 87, 6, 86, 112, 8, 235, 175, 72, 247, 174,
                                    137, 19, 66, 238, 185, 68, 217, 99, 146, 247, 25, 197, 5, 200,
                                    159, 132, 237, 141,
                                  ],
                                },
                              },
                            },
                            'signer-sig': {
                              Optional: {
                                data: {
                                  Sequence: {
                                    Buffer: {
                                      data: [
                                        159, 244, 13, 140, 143, 192, 180, 62, 198, 242, 143, 65,
                                        162, 46, 144, 104, 8, 25, 233, 213, 163, 196, 250, 208, 200,
                                        20, 242, 180, 188, 124, 230, 140, 96, 251, 252, 50, 67, 89,
                                        80, 38, 169, 112, 77, 243, 122, 221, 43, 158, 71, 98, 245,
                                        108, 177, 206, 30, 8, 88, 178, 77, 81, 229, 133, 217, 43, 1,
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                            'end-cycle-id': {
                              Optional: {
                                data: {
                                  UInt: 9,
                                },
                              },
                            },
                            'extend-count': {
                              UInt: 1,
                            },
                            'start-cycle-id': {
                              UInt: 8,
                            },
                            'unlock-burn-height': {
                              UInt: 180,
                            },
                          },
                          type_signature: {
                            type_map: {
                              'auth-id': 'UIntType',
                              'pox-addr': {
                                TupleType: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                              'max-amount': 'UIntType',
                              'signer-key': {
                                SequenceType: {
                                  BufferType: 33,
                                },
                              },
                              'signer-sig': {
                                OptionalType: {
                                  SequenceType: {
                                    BufferType: 65,
                                  },
                                },
                              },
                              'end-cycle-id': {
                                OptionalType: 'UIntType',
                              },
                              'extend-count': 'UIntType',
                              'start-cycle-id': 'UIntType',
                              'unlock-burn-height': 'UIntType',
                            },
                          },
                        },
                      },
                      name: {
                        Sequence: {
                          String: {
                            ASCII: {
                              data: [115, 116, 97, 99, 107, 45, 101, 120, 116, 101, 110, 100],
                            },
                          },
                        },
                      },
                      locked: {
                        UInt: 4125240000000000,
                      },
                      balance: {
                        UInt: 5874759999996985,
                      },
                      stacker: {
                        Principal: {
                          Standard: [
                            26,
                            [
                              213, 64, 168, 166, 84, 196, 192, 245, 79, 145, 2, 18, 255, 59, 17,
                              156, 178, 37, 123, 184,
                            ],
                          ],
                        },
                      },
                      'burnchain-unlock-height': {
                        UInt: 160,
                      },
                    },
                    type_signature: {
                      type_map: {
                        data: {
                          TupleType: {
                            type_map: {
                              'auth-id': 'UIntType',
                              'pox-addr': {
                                TupleType: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                              'max-amount': 'UIntType',
                              'signer-key': {
                                SequenceType: {
                                  BufferType: 33,
                                },
                              },
                              'signer-sig': {
                                OptionalType: {
                                  SequenceType: {
                                    BufferType: 65,
                                  },
                                },
                              },
                              'end-cycle-id': {
                                OptionalType: 'UIntType',
                              },
                              'extend-count': 'UIntType',
                              'start-cycle-id': 'UIntType',
                              'unlock-burn-height': 'UIntType',
                            },
                          },
                        },
                        name: {
                          SequenceType: {
                            StringType: {
                              ASCII: 12,
                            },
                          },
                        },
                        locked: 'UIntType',
                        balance: 'UIntType',
                        stacker: 'PrincipalType',
                        'burnchain-unlock-height': 'UIntType',
                      },
                    },
                  },
                },
                committed: true,
              },
            },
            raw_value:
              '0x070c000000060762616c616e63650100000000000000000014df1026f0c439176275726e636861696e2d756e6c6f636b2d68656967687401000000000000000000000000000000a004646174610c0000000907617574682d69640100000000000000000000c6d4f38cee130c656e642d6379636c652d69640a01000000000000000000000000000000090c657874656e642d636f756e7401000000000000000000000000000000010a6d61782d616d6f756e7401ffffffffffffffffffffffffffffffff08706f782d616464720c00000002096861736862797465730200000014d540a8a654c4c0f54f910212ff3b119cb2257bb80776657273696f6e0200000001000a7369676e65722d6b65790200000021028efa20fa5706567008ebaf48f7ae891342eeb944d96392f719c505c89f84ed8d0a7369676e65722d7369670a02000000419ff40d8c8fc0b43ec6f28f41a22e90680819e9d5a3c4fad0c814f2b4bc7ce68c60fbfc3243595026a9704df37add2b9e4762f56cb1ce1e0858b24d51e585d92b010e73746172742d6379636c652d6964010000000000000000000000000000000812756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000000b4066c6f636b6564010000000000000000000ea7e248d03000046e616d650d0000000c737461636b2d657874656e6407737461636b6572051ad540a8a654c4c0f54f910212ff3b119cb2257bb8',
            contract_identifier: 'ST000000000000000000002AMW42H.pox-4',
          },
        },
        {
          txid: '0xf1c3f935aca7c8feb787e05a1e7611bbcf16da08204b2d9fe82e8e8d556894d8',
          type: 'contract_event',
          committed: true,
          event_index: 3,
          contract_event: {
            topic: 'print',
            value: {
              Response: {
                data: {
                  Tuple: {
                    data_map: {
                      data: {
                        Tuple: {
                          data_map: {
                            'auth-id': {
                              UInt: 207111104693682,
                            },
                            'pox-addr': {
                              Tuple: {
                                data_map: {
                                  version: {
                                    Sequence: {
                                      Buffer: {
                                        data: [0],
                                      },
                                    },
                                  },
                                  hashbytes: {
                                    Sequence: {
                                      Buffer: {
                                        data: [
                                          236, 240, 143, 135, 248, 49, 138, 16, 74, 70, 255, 141,
                                          190, 231, 46, 118, 25, 136, 216, 235,
                                        ],
                                      },
                                    },
                                  },
                                },
                                type_signature: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                            },
                            'max-amount': {
                              UInt: 3.402823669209385e38,
                            },
                            'signer-key': {
                              Sequence: {
                                Buffer: {
                                  data: [
                                    2, 63, 25, 215, 124, 132, 43, 103, 91, 216, 200, 88, 233, 172,
                                    139, 12, 162, 239, 165, 102, 241, 122, 204, 248, 239, 156, 235,
                                    90, 153, 45, 198, 120, 54,
                                  ],
                                },
                              },
                            },
                            'signer-sig': {
                              Optional: {
                                data: {
                                  Sequence: {
                                    Buffer: {
                                      data: [
                                        235, 167, 55, 2, 136, 123, 152, 236, 197, 244, 247, 65, 48,
                                        254, 79, 91, 179, 241, 224, 51, 113, 213, 217, 7, 201, 213,
                                        202, 221, 141, 20, 176, 225, 108, 202, 190, 242, 223, 209,
                                        35, 15, 119, 3, 70, 204, 146, 71, 171, 53, 171, 201, 236,
                                        250, 38, 182, 239, 152, 91, 62, 191, 119, 60, 157, 159, 19,
                                        0,
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                            'end-cycle-id': {
                              Optional: {
                                data: {
                                  UInt: 9,
                                },
                              },
                            },
                            'extend-count': {
                              UInt: 1,
                            },
                            'start-cycle-id': {
                              UInt: 8,
                            },
                            'unlock-burn-height': {
                              UInt: 180,
                            },
                          },
                          type_signature: {
                            type_map: {
                              'auth-id': 'UIntType',
                              'pox-addr': {
                                TupleType: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                              'max-amount': 'UIntType',
                              'signer-key': {
                                SequenceType: {
                                  BufferType: 33,
                                },
                              },
                              'signer-sig': {
                                OptionalType: {
                                  SequenceType: {
                                    BufferType: 65,
                                  },
                                },
                              },
                              'end-cycle-id': {
                                OptionalType: 'UIntType',
                              },
                              'extend-count': 'UIntType',
                              'start-cycle-id': 'UIntType',
                              'unlock-burn-height': 'UIntType',
                            },
                          },
                        },
                      },
                      name: {
                        Sequence: {
                          String: {
                            ASCII: {
                              data: [115, 116, 97, 99, 107, 45, 101, 120, 116, 101, 110, 100],
                            },
                          },
                        },
                      },
                      locked: {
                        UInt: 2750160000000000,
                      },
                      balance: {
                        UInt: 7249839999996988,
                      },
                      stacker: {
                        Principal: {
                          Standard: [
                            26,
                            [
                              236, 240, 143, 135, 248, 49, 138, 16, 74, 70, 255, 141, 190, 231, 46,
                              118, 25, 136, 216, 235,
                            ],
                          ],
                        },
                      },
                      'burnchain-unlock-height': {
                        UInt: 160,
                      },
                    },
                    type_signature: {
                      type_map: {
                        data: {
                          TupleType: {
                            type_map: {
                              'auth-id': 'UIntType',
                              'pox-addr': {
                                TupleType: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                              'max-amount': 'UIntType',
                              'signer-key': {
                                SequenceType: {
                                  BufferType: 33,
                                },
                              },
                              'signer-sig': {
                                OptionalType: {
                                  SequenceType: {
                                    BufferType: 65,
                                  },
                                },
                              },
                              'end-cycle-id': {
                                OptionalType: 'UIntType',
                              },
                              'extend-count': 'UIntType',
                              'start-cycle-id': 'UIntType',
                              'unlock-burn-height': 'UIntType',
                            },
                          },
                        },
                        name: {
                          SequenceType: {
                            StringType: {
                              ASCII: 12,
                            },
                          },
                        },
                        locked: 'UIntType',
                        balance: 'UIntType',
                        stacker: 'PrincipalType',
                        'burnchain-unlock-height': 'UIntType',
                      },
                    },
                  },
                },
                committed: true,
              },
            },
            raw_value:
              '0x070c000000060762616c616e63650100000000000000000019c1b0e9e0d43c176275726e636861696e2d756e6c6f636b2d68656967687401000000000000000000000000000000a004646174610c0000000907617574682d69640100000000000000000000bc5dcfd305b20c656e642d6379636c652d69640a01000000000000000000000000000000090c657874656e642d636f756e7401000000000000000000000000000000010a6d61782d616d6f756e7401ffffffffffffffffffffffffffffffff08706f782d616464720c00000002096861736862797465730200000014ecf08f87f8318a104a46ff8dbee72e761988d8eb0776657273696f6e0200000001000a7369676e65722d6b65790200000021023f19d77c842b675bd8c858e9ac8b0ca2efa566f17accf8ef9ceb5a992dc678360a7369676e65722d7369670a0200000041eba73702887b98ecc5f4f74130fe4f5bb3f1e03371d5d907c9d5cadd8d14b0e16ccabef2dfd1230f770346cc9247ab35abc9ecfa26b6ef985b3ebf773c9d9f13000e73746172742d6379636c652d6964010000000000000000000000000000000812756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000000b4066c6f636b65640100000000000000000009c54185e02000046e616d650d0000000c737461636b2d657874656e6407737461636b6572051aecf08f87f8318a104a46ff8dbee72e761988d8eb',
            contract_identifier: 'ST000000000000000000002AMW42H.pox-4',
          },
        },
        {
          txid: '0x2c4ea25277a45787ddc4f22c3b0960680f5df89abfe1b4536587378fce891d52',
          type: 'contract_event',
          committed: true,
          event_index: 5,
          contract_event: {
            topic: 'print',
            value: {
              Response: {
                data: {
                  Tuple: {
                    data_map: {
                      data: {
                        Tuple: {
                          data_map: {
                            'auth-id': {
                              UInt: 220973827218643,
                            },
                            'pox-addr': {
                              Tuple: {
                                data_map: {
                                  version: {
                                    Sequence: {
                                      Buffer: {
                                        data: [0],
                                      },
                                    },
                                  },
                                  hashbytes: {
                                    Sequence: {
                                      Buffer: {
                                        data: [
                                          234, 188, 101, 243, 232, 144, 251, 139, 242, 13, 21, 62,
                                          149, 17, 156, 114, 216, 87, 101, 169,
                                        ],
                                      },
                                    },
                                  },
                                },
                                type_signature: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                            },
                            'max-amount': {
                              UInt: 3.402823669209385e38,
                            },
                            'signer-key': {
                              Sequence: {
                                Buffer: {
                                  data: [
                                    2, 159, 177, 84, 165, 112, 161, 100, 90, 243, 221, 67, 195, 198,
                                    104, 169, 121, 181, 157, 33, 164, 109, 215, 23, 253, 121, 155,
                                    19, 190, 59, 42, 13, 199,
                                  ],
                                },
                              },
                            },
                            'signer-sig': {
                              Optional: {
                                data: {
                                  Sequence: {
                                    Buffer: {
                                      data: [
                                        73, 48, 27, 127, 117, 255, 120, 126, 160, 188, 47, 239, 174,
                                        85, 162, 107, 217, 23, 53, 119, 42, 146, 143, 112, 138, 138,
                                        87, 173, 130, 79, 164, 22, 107, 255, 76, 28, 93, 234, 138,
                                        111, 63, 63, 142, 85, 143, 154, 189, 143, 107, 29, 59, 99,
                                        95, 115, 226, 200, 168, 225, 34, 100, 17, 58, 245, 24, 0,
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                            'end-cycle-id': {
                              Optional: {
                                data: {
                                  UInt: 9,
                                },
                              },
                            },
                            'extend-count': {
                              UInt: 1,
                            },
                            'start-cycle-id': {
                              UInt: 8,
                            },
                            'unlock-burn-height': {
                              UInt: 180,
                            },
                          },
                          type_signature: {
                            type_map: {
                              'auth-id': 'UIntType',
                              'pox-addr': {
                                TupleType: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                              'max-amount': 'UIntType',
                              'signer-key': {
                                SequenceType: {
                                  BufferType: 33,
                                },
                              },
                              'signer-sig': {
                                OptionalType: {
                                  SequenceType: {
                                    BufferType: 65,
                                  },
                                },
                              },
                              'end-cycle-id': {
                                OptionalType: 'UIntType',
                              },
                              'extend-count': 'UIntType',
                              'start-cycle-id': 'UIntType',
                              'unlock-burn-height': 'UIntType',
                            },
                          },
                        },
                      },
                      name: {
                        Sequence: {
                          String: {
                            ASCII: {
                              data: [115, 116, 97, 99, 107, 45, 101, 120, 116, 101, 110, 100],
                            },
                          },
                        },
                      },
                      locked: {
                        UInt: 1375080000000000,
                      },
                      balance: {
                        UInt: 8624919999996991,
                      },
                      stacker: {
                        Principal: {
                          Standard: [
                            26,
                            [
                              234, 188, 101, 243, 232, 144, 251, 139, 242, 13, 21, 62, 149, 17, 156,
                              114, 216, 87, 101, 169,
                            ],
                          ],
                        },
                      },
                      'burnchain-unlock-height': {
                        UInt: 160,
                      },
                    },
                    type_signature: {
                      type_map: {
                        data: {
                          TupleType: {
                            type_map: {
                              'auth-id': 'UIntType',
                              'pox-addr': {
                                TupleType: {
                                  type_map: {
                                    version: {
                                      SequenceType: {
                                        BufferType: 1,
                                      },
                                    },
                                    hashbytes: {
                                      SequenceType: {
                                        BufferType: 20,
                                      },
                                    },
                                  },
                                },
                              },
                              'max-amount': 'UIntType',
                              'signer-key': {
                                SequenceType: {
                                  BufferType: 33,
                                },
                              },
                              'signer-sig': {
                                OptionalType: {
                                  SequenceType: {
                                    BufferType: 65,
                                  },
                                },
                              },
                              'end-cycle-id': {
                                OptionalType: 'UIntType',
                              },
                              'extend-count': 'UIntType',
                              'start-cycle-id': 'UIntType',
                              'unlock-burn-height': 'UIntType',
                            },
                          },
                        },
                        name: {
                          SequenceType: {
                            StringType: {
                              ASCII: 12,
                            },
                          },
                        },
                        locked: 'UIntType',
                        balance: 'UIntType',
                        stacker: 'PrincipalType',
                        'burnchain-unlock-height': 'UIntType',
                      },
                    },
                  },
                },
                committed: true,
              },
            },
            raw_value:
              '0x070c000000060762616c616e6365010000000000000000001ea451acd0e43f176275726e636861696e2d756e6c6f636b2d68656967687401000000000000000000000000000000a004646174610c0000000907617574682d69640100000000000000000000c8f97a79dcd30c656e642d6379636c652d69640a01000000000000000000000000000000090c657874656e642d636f756e7401000000000000000000000000000000010a6d61782d616d6f756e7401ffffffffffffffffffffffffffffffff08706f782d616464720c00000002096861736862797465730200000014eabc65f3e890fb8bf20d153e95119c72d85765a90776657273696f6e0200000001000a7369676e65722d6b65790200000021029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc70a7369676e65722d7369670a020000004149301b7f75ff787ea0bc2fefae55a26bd91735772a928f708a8a57ad824fa4166bff4c1c5dea8a6f3f3f8e558f9abd8f6b1d3b635f73e2c8a8e12264113af518000e73746172742d6379636c652d6964010000000000000000000000000000000812756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000000b4066c6f636b65640100000000000000000004e2a0c2f01000046e616d650d0000000c737461636b2d657874656e6407737461636b6572051aeabc65f3e890fb8bf20d153e95119c72d85765a9',
            contract_identifier: 'ST000000000000000000002AMW42H.pox-4',
          },
        },
        {
          txid: '0xf1c3f935aca7c8feb787e05a1e7611bbcf16da08204b2d9fe82e8e8d556894d8',
          type: 'stx_lock_event',
          committed: true,
          event_index: 4,
          stx_lock_event: {
            locked_amount: '2750160000000000',
            unlock_height: '180',
            locked_address: 'ST3PF13W7Z0RRM42A8VZRVFQ75SV1K26RXEP8YGKJ',
            contract_identifier: 'ST000000000000000000002AMW42H.pox-4',
          },
        },
      ],
      block_hash: '0x9947cef1f6758fd2074aa62189f4daa4dcdae1a46410ef9cb4dd0224aa10814f',
      block_time: 1729517589,
      miner_txid: '0x50aee39a8f19ddda51765338b54f631b0845907d44402c925d6cc1c12143ed7c',
      reward_set: null,
      block_height: 1,
      cycle_number: null,
      transactions: [
        {
          txid: '0xf5f637dfa7de14fbac5710b6db1367261acc3718281180977d662deed0f3682a',
          raw_tx:
            '0x8080000100040062b0e91cc557e583c3d1f9dfe468ace76d2f0374000000000000001a000000000000012c0001af231d73ae01b19ef43145d6719e78a6659ebeff04fa203fff043a8adc60ce1d424d8da1bcb9b8fa96976736d044f9bdbdb12bbb889bbda5c908f749c150c21d03020000000000051a93b082ee51d78faf5cc3d84a1c1591246c4965b000000000000003e800000000000000000000000000000000000000000000000000000000000000000000',
          status: 'success',
          tx_index: 0,
          raw_result: '0x0703',
          burnchain_op: null,
          contract_abi: null,
          execution_cost: {
            runtime: 0,
            read_count: 0,
            read_length: 0,
            write_count: 0,
            write_length: 0,
          },
          microblock_hash: null,
          microblock_sequence: null,
          microblock_parent_hash: null,
        },
        {
          txid: '0x52293f29d4896f57011cef4b63afb936905e6d6fc55d7490e89b2711e4b2e6f7',
          raw_tx:
            '0x80800001000400d540a8a654c4c0f54f910212ff3b119cb2257bb8000000000000000200000000000003f000015c8cacf7c679fdc161e1b133751794cb5a1540708b98b8eb74587c5adcc8b8c6049ce2498ac1794280ead0d8e9772a8c9bacfae51bba11705435fa64703138b3030200000000021a000000000000000000000000000000000000000005706f782d340c737461636b2d657874656e640000000601000000000000000000000000000000010c00000002096861736862797465730200000014d540a8a654c4c0f54f910212ff3b119cb2257bb80776657273696f6e0200000001000a02000000419ff40d8c8fc0b43ec6f28f41a22e90680819e9d5a3c4fad0c814f2b4bc7ce68c60fbfc3243595026a9704df37add2b9e4762f56cb1ce1e0858b24d51e585d92b010200000021028efa20fa5706567008ebaf48f7ae891342eeb944d96392f719c505c89f84ed8d01ffffffffffffffffffffffffffffffff0100000000000000000000c6d4f38cee13',
          status: 'success',
          tx_index: 1,
          raw_result:
            '0x070c0000000207737461636b6572051ad540a8a654c4c0f54f910212ff3b119cb2257bb812756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000000b4',
          burnchain_op: null,
          contract_abi: null,
          execution_cost: {
            runtime: 749762,
            read_count: 26,
            read_length: 77724,
            write_count: 6,
            write_length: 858,
          },
          microblock_hash: null,
          microblock_sequence: null,
          microblock_parent_hash: null,
        },
        {
          txid: '0xf1c3f935aca7c8feb787e05a1e7611bbcf16da08204b2d9fe82e8e8d556894d8',
          raw_tx:
            '0x80800001000400ecf08f87f8318a104a46ff8dbee72e761988d8eb000000000000000200000000000003ef0001b1873c7afe4b00342e4ef20887efec1646430b08fbc1c4f19f788545521ec26f144ad6a9d8a1a96c01209fbd05259c9f721e9fddcf0ee7ad2dbfca541e9b48ea030200000000021a000000000000000000000000000000000000000005706f782d340c737461636b2d657874656e640000000601000000000000000000000000000000010c00000002096861736862797465730200000014ecf08f87f8318a104a46ff8dbee72e761988d8eb0776657273696f6e0200000001000a0200000041eba73702887b98ecc5f4f74130fe4f5bb3f1e03371d5d907c9d5cadd8d14b0e16ccabef2dfd1230f770346cc9247ab35abc9ecfa26b6ef985b3ebf773c9d9f13000200000021023f19d77c842b675bd8c858e9ac8b0ca2efa566f17accf8ef9ceb5a992dc6783601ffffffffffffffffffffffffffffffff0100000000000000000000bc5dcfd305b2',
          status: 'success',
          tx_index: 2,
          raw_result:
            '0x070c0000000207737461636b6572051aecf08f87f8318a104a46ff8dbee72e761988d8eb12756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000000b4',
          burnchain_op: null,
          contract_abi: null,
          execution_cost: {
            runtime: 753295,
            read_count: 26,
            read_length: 77785,
            write_count: 6,
            write_length: 858,
          },
          microblock_hash: null,
          microblock_sequence: null,
          microblock_parent_hash: null,
        },
        {
          txid: '0x2c4ea25277a45787ddc4f22c3b0960680f5df89abfe1b4536587378fce891d52',
          raw_tx:
            '0x80800001000400eabc65f3e890fb8bf20d153e95119c72d85765a9000000000000000200000000000003ee0000cf5d6138befda37c9880a9e0c333c3ecb1d18f3f24f7479f5ded4b63b22b3156795c5e5a9bf2e46e87bacec540cdab0187bd3cb40d58e137a5fa97fb7bb2be90030200000000021a000000000000000000000000000000000000000005706f782d340c737461636b2d657874656e640000000601000000000000000000000000000000010c00000002096861736862797465730200000014eabc65f3e890fb8bf20d153e95119c72d85765a90776657273696f6e0200000001000a020000004149301b7f75ff787ea0bc2fefae55a26bd91735772a928f708a8a57ad824fa4166bff4c1c5dea8a6f3f3f8e558f9abd8f6b1d3b635f73e2c8a8e12264113af518000200000021029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc701ffffffffffffffffffffffffffffffff0100000000000000000000c8f97a79dcd3',
          status: 'success',
          tx_index: 3,
          raw_result:
            '0x070c0000000207737461636b6572051aeabc65f3e890fb8bf20d153e95119c72d85765a912756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000000b4',
          burnchain_op: null,
          contract_abi: null,
          execution_cost: {
            runtime: 753295,
            read_count: 26,
            read_length: 77785,
            write_count: 6,
            write_length: 858,
          },
          microblock_hash: null,
          microblock_sequence: null,
          microblock_parent_hash: null,
        },
      ],
      anchored_cost: {
        runtime: 2256352,
        read_count: 78,
        read_length: 233294,
        write_count: 18,
        write_length: 2574,
      },
      signer_bitvec: '000800000001ff',
      tenure_height: 35,
      burn_block_hash: '0x3f96d68c6f023d9f209956b372bfbd56e1790fab59597b954a1d70e864fd39c1',
      burn_block_time: 1729517584,
      miner_signature:
        '0x018ea9b2502fe44200b718ab5bfdc497f5908fa630f6744a123d69e41e7c450f997ffcd7e0fe6f78f6c4ef022d801394158c11fdd907bfae9b1beb5d20a5337fbc',
      index_block_hash: '0xc75e30fbcf6053515db77754820b3a2ce6bc38d62511c33791ac6e287e3b3d82',
      signer_signature: [
        '00b9aa245012732d9d6190df42b338491f4f6c7cd166dc2039274bf5057e1086a4531a00b1e020e25a279e96a3d92b7208ef8e13ae32728c855bcc032bdbedfcf4',
        '0087d8ae60f7be757c2621564089edab286cb2db685ea0bc08fca7c9cdda1a63294520890e52467f39f6caddd7fc93a71c33b6b3ae310cfca86bae841c9cdfbc6d',
        '00a895a08d250d2b9b84b27e4d03e106e6341dafd82e93f9913656023daadb34f775feda8f74aae43f53689e1f1dd9fb740b3206364db5936ab92259a531c61494',
      ],
      burn_block_height: 140,
      parent_block_hash: '0x25b7c5459b9d955bc8a3afb3943df54b44f7175946ccb4c792fb46838fa4df68',
      parent_microblock: '0x0000000000000000000000000000000000000000000000000000000000000000',
      pox_v1_unlock_height: 104,
      pox_v2_unlock_height: 106,
      pox_v3_unlock_height: 109,
      matured_miner_rewards: [],
      signer_signature_hash: '0x9947cef1f6758fd2074aa62189f4daa4dcdae1a46410ef9cb4dd0224aa10814f',
      parent_burn_block_hash: '0x3f96d68c6f023d9f209956b372bfbd56e1790fab59597b954a1d70e864fd39c1',
      parent_index_block_hash: '0x7d0cf996be2f9f18a2c791de4b374ec90ad6fb26405d0d27f0e5c368be74b575',
      parent_burn_block_height: 140,
      confirmed_microblocks_cost: {
        runtime: 0,
        read_count: 0,
        read_length: 0,
        write_count: 0,
        write_length: 0,
      },
      parent_microblock_sequence: 0,
      parent_burn_block_timestamp: 1729517584,
    };

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const dbBlock1 = await db.getBlock({ hash: payload.block_hash });
    expect(dbBlock1.found).toBe(true);
    expect(dbBlock1.result?.execution_cost_read_count).toBe(payload.anchored_cost.read_count);
    expect(dbBlock1.result?.execution_cost_read_length).toBe(payload.anchored_cost.read_length);
    expect(dbBlock1.result?.execution_cost_runtime).toBe(payload.anchored_cost.runtime);
    expect(dbBlock1.result?.execution_cost_write_count).toBe(payload.anchored_cost.write_count);
    expect(dbBlock1.result?.execution_cost_write_length).toBe(payload.anchored_cost.write_length);
  });
});
