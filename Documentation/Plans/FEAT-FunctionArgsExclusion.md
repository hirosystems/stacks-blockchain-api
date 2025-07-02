# Function Args Exclusion for Transaction Endpoints

## Executive Summary

This change introduces a **single boolean query-parameter `exclude_function_args`** to the Stacks Blockchain API.

* **Where it applies** – initially supported on the `GET /extended/v1/tx` list endpoint and the `GET /extended/v1/tx/:tx_id` single-transaction endpoint.
* **What it does** – when the parameter is present and `true`, the API server omits the `function_args` array from every `contract_call` transaction in the response payload.  All other fields and all non-contract-call transactions remain untouched.
* **How it works** –
  1. Add `ExcludeFunctionArgsParamSchema` (optional boolean) to the shared query-param TypeBox definitions.
  2. Extend the `GetTx*`/`GetTxs*` interface objects with an optional `excludeFunctionArgs` flag.
  3. Thread that flag through datastore helpers and parsing utilities (`parseDbTx`, `parseDbMempoolTx`, etc.).
  4. Update `parseContractCallMetadata` to conditionally skip the expensive `decodeClarityValueList` block when the flag is `true`.
  5. Surface the parameter in the two affected routes and propagate it to their underlying database calls.
  6. Supply unit + integration tests and a compile-time (`tsc`) guard to ensure every call-site handles the new flag.
* **Default behaviour** – the parameter defaults to `false`, preserving 100 % backward compatibility.
* **Scope** – other endpoints (blocks, mempool, search, WebSockets) intentionally retain the full `function_args` field for now; a follow-up ticket can evaluate widening coverage once the core change is proven stable.

Ideally, this is a ~50 LOC, no-schema-breaking modification that gives clients a deterministic way to control payload size without altering any existing response contracts.

---

## Problem Statement

### Current Pain Points

The `function_args` field in contract call transaction responses creates significant challenges for API clients:

1. **Unpredictable Response Sizes**: Transaction pages can vary from ~5KB to ~50KB depending on the complexity of contract function arguments
2. **Conservative Pagination**: Clients must use small page sizes (limit=10-20) to avoid unexpectedly large responses
3. **Increased API Calls**: Conservative pagination results in 3-5x more API calls than would be optimal
4. **Poor Performance Planning**: Clients cannot accurately estimate bandwidth usage or response times

### Technical Root Cause

The `function_args` field contains decoded Clarity values with multiple representations:

```json
{
  "hex": "0x0c000000020968617368627974657302000000204d4daaf0776c1bbeb4c6bb14e7499acc72c250bde7146ef79c8b051eb4cb85930776657273696f6e020000000106",
  "repr": "(tuple (hashbytes 0x4d4daaf0776c1bbeb4c6bb14e7499acc72c250bde7146ef79c8b051eb4cb8593) (version 0x06))",
  "name": "pox-addr",
  "type": "(tuple (hashbytes (buff 32)) (version (buff 1)))"
}
```

**Size Analysis**:
- Simple arguments (uint, bool, principal): ~50-100 bytes each 
  - Each includes type_id, hex representation, repr string, and value
  - 128-bit integers require 32-character hex encoding (16 bytes)
- Complex arguments (tuples, lists, buffers): ~200-1000+ bytes each
  - Nested structures multiply encoding overhead  
  - Lists and tuples include metadata for each element
- Typical contract calls: 2-8 arguments = ~100-8,000 bytes total function_args field


## Proposed Solution

### Core Approach: Single Parameter Exclusion

Add one query parameter `exclude_function_args` to transaction endpoints that optionally removes the `function_args` field from contract call responses.

**Design Principles**:
- **Minimal Implementation**: Smallest possible change to achieve the goal
- **Zero Breaking Changes**: Default behavior remains identical
- **Direct Problem Solving**: Addresses the exact client need without over-engineering
- **Backward Compatible**: Existing clients continue working unchanged

### Implementation Details

#### 1. Parameter Schema Addition

**File**: `src/api/schemas/params.ts`

```typescript
export const ExcludeFunctionArgsParamSchema = Type.Optional(
  Type.Boolean({
    default: false,
    description:
      'Exclude function_args from contract call responses for smaller, predictable sizes. Only explicit true/false values are accepted (same pattern as `unanchored`).',
    examples: [true, false],
  })
);
```

#### 2. Interface Updates

**File**: `src/api/controllers/db-controller.ts` (lines 864-884)

```typescript
interface GetTxArgs {
  txId: string;
  includeUnanchored: boolean;
  excludeFunctionArgs?: boolean;
}

interface GetTxFromDbTxArgs extends GetTxArgs {
  dbTx: DbTx;
}

interface GetTxsWithEventsArgs extends GetTxsArgs {
  eventLimit: number;
  eventOffset: number;
}

interface GetTxsArgs {
  txIds: string[];
  includeUnanchored: boolean;
  excludeFunctionArgs?: boolean;
}

interface GetTxWithEventsArgs extends GetTxArgs {
  eventLimit: number;
  eventOffset: number;
}
```

#### 3. Core Processing Function Modification

**File**: `src/api/controllers/db-controller.ts`

```typescript
export function parseContractCallMetadata(
  tx: BaseTx, 
  excludeFunctionArgs: boolean = false
): ContractCallTransactionMetadata {
  const contractId = unwrapOptional(
    tx.contract_call_contract_id,
    () => 'Unexpected nullish contract_call_contract_id'
  );
  const functionName = unwrapOptional(
    tx.contract_call_function_name,
    () => 'Unexpected nullish contract_call_function_name'
  );
  let functionAbi: ClarityAbiFunction | undefined;
  const abi = tx.abi;
  if (abi) {
    const contractAbi: ClarityAbi = JSON.parse(abi);
    functionAbi = contractAbi.functions.find(fn => fn.name === functionName);
    if (!functionAbi) {
      throw new Error(`Could not find function name "${functionName}" in ABI for ${contractId}`);
    }
  }

  const contractCall: {
    contract_id: string;
    function_name: string;
    function_signature: string;
    function_args?: Array<{
      hex: string;
      repr: string;
      name: string;
      type: string;
    }>;
  } = {
    contract_id: contractId,
    function_name: functionName,
    function_signature: functionAbi ? abiFunctionToString(functionAbi) : '',
  };

  // Only process function_args if not excluded
  if (!excludeFunctionArgs && tx.contract_call_function_args) {
    contractCall.function_args = decodeClarityValueList(tx.contract_call_function_args).map((c, idx) => {
      const functionArgAbi = functionAbi?.args[idx] || { name: '', type: undefined };
      return {
        hex: c.hex,
        repr: c.repr,
        name: functionArgAbi.name,
        type: functionArgAbi.type
          ? getTypeString(functionArgAbi.type)
          : decodeClarityValueToTypeName(c.hex),
      };
    });
  }

  const metadata: ContractCallTransactionMetadata = {
    tx_type: 'contract_call',
    contract_call: contractCall,
  };
  return metadata;
}
```

#### 4. Parameter Threading Through Parse Chain

```typescript
function parseDbTxTypeMetadata(
  dbTx: DbTx | DbMempoolTx, 
  excludeFunctionArgs: boolean = false
): TransactionMetadata {
  switch (dbTx.type_id) {
    // ... other cases unchanged
    case DbTxTypeId.ContractCall: {
      return parseContractCallMetadata(dbTx, excludeFunctionArgs);
    }
    // ... rest unchanged
  }
}

export function parseDbTx(dbTx: DbTx, excludeFunctionArgs: boolean = false): Transaction {
  const baseTx = parseDbBaseTx(dbTx);
  const abstractTx = parseDbAbstractTx(dbTx, baseTx);
  const txMetadata = parseDbTxTypeMetadata(dbTx, excludeFunctionArgs);
  const result: Transaction = {
    ...abstractTx,
    ...txMetadata,
  };
  return result;
}

export function parseDbMempoolTx(dbMempoolTx: DbMempoolTx, excludeFunctionArgs: boolean = false): MempoolTransaction {
  const baseTx = parseDbBaseTx(dbMempoolTx);
  const abstractTx = parseDbAbstractMempoolTx(dbMempoolTx, baseTx);
  const txMetadata = parseDbTxTypeMetadata(dbMempoolTx, excludeFunctionArgs);
  const result: MempoolTransaction = {
    ...abstractTx,
    ...txMetadata,
  };
  return result;
}
```

#### 5. Update Data Store Functions

```typescript
async function getTxsFromDataStore(
  db: PgStore,
  args: GetTxsArgs | GetTxsWithEventsArgs
): Promise<Transaction[]> {
  return await db.sqlTransaction(async sql => {
    const txQuery = await db.getTxListDetails({
      txIds: args.txIds,
      includeUnanchored: args.includeUnanchored,
    });

    if (txQuery.length === 0) {
      return [];
    }

    // Pass excludeFunctionArgs parameter through to parsing
    const parsedTxs = txQuery.map(tx => parseDbTx(tx, args.excludeFunctionArgs ?? false));

    if ('eventLimit' in args) {
      const txIdsAndIndexHash = txQuery.map(tx => ({
        txId: tx.tx_id,
        indexBlockHash: tx.index_block_hash,
      }));
      const txListEvents = await db.getTxListEvents({
        txs: txIdsAndIndexHash,
        limit: args.eventLimit,
        offset: args.eventOffset,
      });
      const txsWithEvents: Transaction[] = parsedTxs.map(ptx => ({
        ...ptx,
        events: txListEvents.results
          .filter(event => event.tx_id === ptx.tx_id)
          .map(event => parseDbEvent(event)),
      }));
      return txsWithEvents;
    } else {
      return parsedTxs;
    }
  });
}

export async function getTxFromDataStore(
  db: PgStore,
  args: GetTxArgs | GetTxWithEventsArgs | GetTxFromDbTxArgs
): Promise<FoundOrNot<Transaction>> {
  return await db.sqlTransaction(async sql => {
    let dbTx: DbTx;
    if ('dbTx' in args) {
      dbTx = args.dbTx;
    } else {
      const txQuery = await db.getTx({
        txId: args.txId,
        includeUnanchored: args.includeUnanchored,
      });
      if (!txQuery.found) {
        return { found: false };
      }
      dbTx = txQuery.result;
    }

    const parsedTx = parseDbTx(dbTx, args.excludeFunctionArgs ?? false);

    if ('eventLimit' in args) {
      const eventsQuery = await db.getTxEvents({
        txId: args.txId,
        indexBlockHash: dbTx.index_block_hash,
        limit: args.eventLimit,
        offset: args.eventOffset,
      });
      const txWithEvents: Transaction = {
        ...parsedTx,
        events: eventsQuery.results.map(event => parseDbEvent(event)),
      };
      return { found: true, result: txWithEvents };
    } else {
      return {
        found: true,
        result: parsedTx,
      };
    }
  });
}

export async function getMempoolTxsFromDataStore(
  db: PgStore,
  args: GetTxsArgs
): Promise<MempoolTransaction[]> {
  const mempoolTxsQuery = await db.getMempoolTxs({
    txIds: args.txIds,
    includePruned: true,
    includeUnanchored: args.includeUnanchored,
  });
  if (mempoolTxsQuery.length === 0) {
    return [];
  }

  const parsedMempoolTxs = mempoolTxsQuery.map(tx => 
    parseDbMempoolTx(tx, args.excludeFunctionArgs ?? false)
  );

  return parsedMempoolTxs;
}
```

#### 6. Transaction Endpoint Updates

**File**: `src/api/routes/tx.ts`

```typescript
// Transaction list endpoint
fastify.get('/', {
  schema: {
    operationId: 'get_transaction_list',
    summary: 'Get recent transactions',
    description: 'Retrieves all recently mined transactions',
    tags: ['Transactions'],
    querystring: Type.Object({
      offset: OffsetParam(),
      limit: LimitParam(ResourceType.Tx),
      type: Type.Optional(Type.Array(TransactionTypeSchema)),
      unanchored: UnanchoredParamSchema,
      order: Type.Optional(Type.Enum({ asc: 'asc', desc: 'desc' })),
      sort_by: Type.Optional(
        Type.Enum({
          block_height: 'block_height',
          burn_block_time: 'burn_block_time',
          fee: 'fee',
        }, {
          default: 'block_height',
          description: 'Option to sort results by block height, timestamp, or fee',
        })
      ),
      from_address: Type.Optional(
        Type.String({ description: 'Option to filter results by sender address' })
      ),
      to_address: Type.Optional(
        Type.String({ description: 'Option to filter results by recipient address' })
      ),
      start_time: Type.Optional(
        Type.Integer({
          description: 'Filter by transactions after this timestamp (unix timestamp in seconds)',
          examples: [1704067200],
        })
      ),
      end_time: Type.Optional(
        Type.Integer({
          description: 'Filter by transactions before this timestamp (unix timestamp in seconds)',
          examples: [1706745599],
        })
      ),
      contract_id: Type.Optional(
        Type.String({
          description: 'Option to filter results by contract ID',
          examples: ['SP000000000000000000002Q6VF78.pox-4'],
        })
      ),
      function_name: Type.Optional(
        Type.String({
          description: 'Filter by contract call transactions involving this function name',
          examples: ['delegate-stx'],
        })
      ),
      nonce: Type.Optional(
        Type.Integer({
          description: 'Filter by transactions with this nonce',
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
          examples: [123],
        })
      ),
      exclude_function_args: ExcludeFunctionArgsParamSchema,
    }),
    response: {
      200: TransactionResultsSchema,
    },
  },
}, async (req, reply) => {
  const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
  const offset = parsePagingQueryInput(req.query.offset ?? 0);
  const excludeFunctionArgs = req.query.exclude_function_args ?? false;

  const { results: txResults, total } = await fastify.db.getTxList({
    offset,
    limit,
    txTypeFilter: parseTxTypeStrings(req.query.type ?? []),
    includeUnanchored: req.query.unanchored ?? false,
    fromAddress: req.query.from_address,
    toAddress: req.query.to_address,
    startTime: req.query.start_time,
    endTime: req.query.end_time,
    contractId: req.query.contract_id,
    functionName: req.query.function_name,
    nonce: req.query.nonce,
    order: req.query.order,
    sortBy: req.query.sort_by,
  });
  
  const results = txResults.map(tx => parseDbTx(tx, excludeFunctionArgs));
  await reply.send({ limit, offset, total, results });
});

// Single transaction endpoint
fastify.get('/:tx_id', {
  schema: {
    operationId: 'get_transaction_by_id',
    summary: 'Get transaction',
    description: 'Retrieves transaction details for a given transaction ID',
    tags: ['Transactions'],
    params: Type.Object({
      tx_id: TransactionIdParamSchema,
    }),
    querystring: Type.Object({
      event_limit: LimitParam(ResourceType.Event, undefined, undefined, 100),
      event_offset: OffsetParam(),
      unanchored: UnanchoredParamSchema,
      exclude_function_args: ExcludeFunctionArgsParamSchema,
    }),
    response: {
      200: Type.Union([TransactionSchema, MempoolTransactionSchema]),
    },
  },
}, async (req, reply) => {
  const { tx_id } = req.params;
  const excludeFunctionArgs = req.query.exclude_function_args ?? false;
  
  // ... existing validation logic ...

  const txQuery = await searchTx(fastify.db, {
    txId: tx_id,
    eventLimit: getPagingQueryLimit(ResourceType.Event, req.query['event_limit'], 100),
    eventOffset: parsePagingQueryInput(req.query['event_offset'] ?? 0),
    includeUnanchored: req.query.unanchored ?? false,
    excludeFunctionArgs, // Pass parameter through
  });
  
  if (!txQuery.found) {
    throw new NotFoundError('could not find transaction by ID');
  }
  
  const result: Transaction | MempoolTransaction = txQuery.result;
  await reply.send(result);
});
```

#### 7. Address Transaction Endpoints

**File**: `src/api/routes/address.ts` and `src/api/routes/v2/addresses.ts`

Add the parameter to address transaction endpoints:

```typescript
fastify.get('/:principal/transactions', {
  schema: {
    querystring: Type.Object({
      limit: LimitParam(ResourceType.Tx),
      offset: OffsetParam(),
      height: Type.Optional(Type.Integer()),
      unanchored: UnanchoredParamSchema,
      until_block: UntilBlockSchema,
      exclude_function_args: ExcludeFunctionArgsParamSchema,
    }),
  },
}, async (req, reply) => {
  const excludeFunctionArgs = req.query.exclude_function_args ?? false;
  
  // ... existing logic ...
  
  // Apply to result parsing
  const results = txResults.map(tx => parseDbTx(tx, excludeFunctionArgs));
  await reply.send({ limit, offset, total, results });
});
```

### Testing Strategy

1. **Compile-time safety**: `npm run build` (tsc) must succeed, guaranteeing every call-site passes the new flag where desired.
2. **Endpoint tests** – four Jest cases mirroring the existing style:
   * `exclude_function_args` works for single contract-call tx (existing snippet).
   * Default behaviour (flag omitted) still returns `function_args`.
   * Transaction list endpoint respects flag.
   * **NEW** Block endpoint integration test – fetch `/extended/v1/block/:hash?exclude_function_args=true` and assert all contract-call txs omit the field, proving flag propagation through internal helpers.

Example (block test skeleton):

```typescript
test('exclude_function_args propagates to block endpoint', async () => {
  const block = /* build block with contract-call tx */
  await db.update(block);

  const res = await supertest(api.server)
    .get(`/extended/v1/block/${block.hash}?exclude_function_args=true`)
    .expect(200);

  res.body.txs
    .filter(tx => tx.tx_type === 'contract_call')
    .forEach(tx => expect(tx.contract_call.function_args).toBeUndefined());
});
```

Other unit test snippets remain unchanged.

### Expected Performance Impact

#### Response Size Reduction
The size reduction will vary significantly based on transaction mix and contract complexity:
- **Simple contract calls**: Modest reduction from removing basic function arguments (uint, bool values)
- **Complex DeFi transactions**: Larger reduction from removing complex tuple/list arguments with multiple nested values
- **PoX stacking transactions**: Meaningful reduction from removing address tuple arguments
- **Mixed transaction pages**: Variable reduction depending on the ratio of contract calls to other transaction types
- **Non-contract transactions**: No reduction (STX transfers, contract deployments, etc.)


### Production Considerations

#### Error Handling Analysis

The implementation requires careful error handling for production scale:

**Parameter Validation**:
- TypeBox automatically handles boolean validation
- Invalid values like "exclude_function_args=invalid" return 400 Bad Request
- Empty values like "exclude_function_args=" default to false

**Processing Failures**:
- If `decodeClarityValueList` fails when `excludeFunctionArgs=false`, the error remains identical to current behavior
- No new error conditions are introduced by the exclusion logic
- Graceful degradation: if ABI parsing fails, function_args are still excluded when requested

**Edge Cases**:
- Transactions with malformed `contract_call_function_args` behave identically regardless of exclusion parameter
- Mempool transactions with incomplete data handle exclusion correctly
- Non-contract-call transactions ignore the parameter without errors

#### Type Safety Considerations

For an API serving millions of requests, type safety is critical:

**Response Type Consistency**:
```typescript
interface ContractCallMetadata {
  contract_id: string;
  function_name: string;
  function_signature: string;
  function_args?: FunctionArg[]; // Optional field - conditionally present
}
```

**Client Impact**:
- TypeScript clients will see `function_args` as potentially undefined
- Clients must handle both cases: `tx.contract_call.function_args?.length` 
- No runtime type errors since field is properly optional
- Existing clients continue working without TypeScript errors

#### Caching Implications

Cache strategy must account for parameter variations:

**Cache Key Requirements**:
```typescript
// Cache keys must include the exclusion parameter:
// Current: "tx_list:offset=0:limit=20:type=contract_call"
// Updated: "tx_list:offset=0:limit=20:type=contract_call:exclude_function_args=true"
```

**Cache Efficiency**:
- Two cache entries per transaction list query (with/without function_args)
- Individual transaction caches also split by parameter
- Memory usage roughly doubles for cached transaction responses
- Cache hit rates may initially decrease until usage patterns stabilize

**Cache Invalidation**:
- No changes to invalidation logic - both variants invalidated together
- Block updates invalidate all related transaction caches regardless of parameter

#### Known Limitations

The initial implementation scopes the new parameter to **transaction list** and **single-transaction** endpoints only.  Block endpoints, mempool routes, token/search helpers, and WebSocket streams continue to include `function_args`.  This can be expanded on as desired.
