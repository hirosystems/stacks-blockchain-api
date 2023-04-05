import {
  DbPox2BaseEventData,
  DbPox2DelegateStackExtendEvent,
  DbPox2DelegateStackIncreaseEvent,
  DbPox2DelegateStackStxEvent,
  DbPox2DelegateStxEvent,
  DbPox2EventData,
  DbPox2HandleUnlockEvent,
  DbPox2StackAggregationCommitEvent,
  DbPox2StackAggregationCommitIndexedEvent,
  DbPox2StackAggregationIncreaseEvent,
  DbPox2StackExtendEvent,
  DbPox2StackIncreaseEvent,
  DbPox2StackStxEvent,
} from '../datastore/common';
import { bufferToHexPrefixString, coerceToBuffer, has0xPrefix, logger } from '../helpers';

import {
  ClarityTypeID,
  ClarityValue,
  ClarityValueAbstract,
  ClarityValueBuffer,
  ClarityValueOptionalNone,
  ClarityValueOptionalSome,
  ClarityValuePrincipalContract,
  ClarityValuePrincipalStandard,
  ClarityValueResponse,
  ClarityValueStringAscii,
  ClarityValueTuple,
  ClarityValueUInt,
  decodeClarityValue,
} from 'stacks-encoding-native-js';
import { poxAddressToBtcAddress } from '@stacks/stacking';
import { Pox2EventName } from '../pox-helpers';

function tryClarityPoxAddressToBtcAddress(
  poxAddr: Pox2Addr | ClarityValueOptionalSome<Pox2Addr> | ClarityValueOptionalNone,
  network: 'mainnet' | 'testnet' | 'regtest'
): { btcAddr: string | null; raw: Buffer } {
  let btcAddr: string | null = null;
  if (poxAddr.type_id === ClarityTypeID.OptionalNone) {
    return {
      btcAddr,
      raw: Buffer.alloc(0),
    };
  }
  if (poxAddr.type_id === ClarityTypeID.OptionalSome) {
    poxAddr = poxAddr.value;
  }
  try {
    btcAddr = poxAddressToBtcAddress(
      coerceToBuffer(poxAddr.data.version.buffer)[0],
      coerceToBuffer(poxAddr.data.hashbytes.buffer),
      network
    );
  } catch (e) {
    logger.verbose(
      `Error encoding PoX address version: ${poxAddr.data.version.buffer}, hashbytes: ${poxAddr.data.hashbytes.buffer} to bitcoin address: ${e}`
    );
    btcAddr = null;
  }
  return {
    btcAddr,
    raw: Buffer.concat([
      coerceToBuffer(poxAddr.data.version.buffer),
      coerceToBuffer(poxAddr.data.hashbytes.buffer),
    ]),
  };
}

type Pox2Addr = ClarityValueTuple<{
  hashbytes: ClarityValueBuffer;
  version: ClarityValueBuffer;
}>;

type PoX2EventData = ClarityValueTuple<{
  name: ClarityValueStringAscii;
  balance: ClarityValueUInt;
  stacker: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  locked: ClarityValueUInt;
  'burnchain-unlock-height': ClarityValueUInt;
  data: ClarityValueTuple;
}>;

interface Pox2PrintEventTypes {
  [Pox2EventName.HandleUnlock]: {
    'first-cycle-locked': ClarityValueUInt;
    'first-unlocked-cycle': ClarityValueUInt;
  };
  [Pox2EventName.StackStx]: {
    'lock-amount': ClarityValueUInt;
    'lock-period': ClarityValueUInt;
    'pox-addr': Pox2Addr;
    'start-burn-height': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
  };
  [Pox2EventName.StackIncrease]: {
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
  };
  [Pox2EventName.StackExtend]: {
    'extend-count': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
    'pox-addr': Pox2Addr;
  };
  [Pox2EventName.DelegateStx]: {
    'amount-ustx': ClarityValueUInt;
    'delegate-to': ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
    'unlock-burn-height': ClarityValueOptionalSome<ClarityValueUInt> | ClarityValueOptionalNone;
    'pox-addr': Pox2Addr | ClarityValueOptionalNone;
  };
  [Pox2EventName.DelegateStackStx]: {
    'lock-amount': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
    'pox-addr': Pox2Addr;
    'start-burn-height': ClarityValueUInt;
    'lock-period': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  [Pox2EventName.DelegateStackIncrease]: {
    'pox-addr': Pox2Addr;
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  [Pox2EventName.DelegateStackExtend]: {
    'pox-addr': Pox2Addr;
    'unlock-burn-height': ClarityValueUInt;
    'extend-count': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  [Pox2EventName.StackAggregationCommit]: {
    'pox-addr': Pox2Addr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
  [Pox2EventName.StackAggregationCommitIndexed]: {
    'pox-addr': Pox2Addr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
  [Pox2EventName.StackAggregationIncrease]: {
    'pox-addr': Pox2Addr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
}

function clarityPrincipalToFullAddress(
  principal: ClarityValuePrincipalStandard | ClarityValuePrincipalContract
): string {
  if (principal.type_id === ClarityTypeID.PrincipalStandard) {
    return principal.address;
  } else if (principal.type_id === ClarityTypeID.PrincipalContract) {
    return `${principal.address}.${principal.contract_name}`;
  }
  throw new Error(
    `Unexpected Clarity value type for principal: ${(principal as ClarityValue).type_id}`
  );
}

// TODO: this and the logic referencing it can be removed once the "stale" data issue is fixed in
// https://github.com/stacks-network/stacks-blockchain/pull/3318
const PATCH_EVENT_BALANCES = true;

export function decodePox2PrintEvent(
  rawClarityData: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): DbPox2EventData | null {
  const decoded = decodeClarityValue<ClarityValueResponse>(rawClarityData);
  if (decoded.type_id === ClarityTypeID.ResponseError) {
    logger.info(`Received ResponseError when decoding Pox2 print event: ${decoded.repr}`);
    return null;
  }
  if (decoded.type_id !== ClarityTypeID.ResponseOk) {
    const valCommon: ClarityValueAbstract = decoded;
    throw new Error(
      `Unexpected PoX2 event Clarity type ID, expected ResponseOk, got ${valCommon.type_id}: ${valCommon.repr}`
    );
  }
  if (decoded.value.type_id !== ClarityTypeID.Tuple) {
    throw new Error(
      `Unexpected PoX2 event Clarity type ID, expected Tuple, got ${decoded.value.type_id}`
    );
  }
  const opData = (decoded.value as PoX2EventData).data;

  const baseEventData: DbPox2BaseEventData = {
    stacker: clarityPrincipalToFullAddress(opData.stacker),
    locked: BigInt(opData.locked.value),
    balance: BigInt(opData.balance.value),
    burnchain_unlock_height: BigInt(opData['burnchain-unlock-height'].value),
    pox_addr: null,
    pox_addr_raw: null,
  };

  const eventName = opData.name.data as keyof Pox2PrintEventTypes;
  if (opData.name.type_id !== ClarityTypeID.StringAscii) {
    throw new Error(
      `Unexpected PoX2 event name type, expected StringAscii, got ${opData.name.type_id}`
    );
  }

  const eventData = opData.data.data;
  if (opData.data.type_id !== ClarityTypeID.Tuple) {
    throw new Error(
      `Unexpected PoX2 event data payload type, expected Tuple, got ${opData.data.type_id}`
    );
  }

  if ('pox-addr' in eventData) {
    const eventPoxAddr = eventData['pox-addr'] as
      | Pox2Addr
      | ClarityValueOptionalSome<Pox2Addr>
      | ClarityValueOptionalNone;
    const encodedArr = tryClarityPoxAddressToBtcAddress(eventPoxAddr, network);
    baseEventData.pox_addr = encodedArr.btcAddr;
    baseEventData.pox_addr_raw = bufferToHexPrefixString(encodedArr.raw);
  }

  switch (eventName) {
    case Pox2EventName.HandleUnlock: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2HandleUnlockEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          first_cycle_locked: BigInt(d['first-cycle-locked'].value),
          first_unlocked_cycle: BigInt(d['first-unlocked-cycle'].value),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        // Note: `burnchain_unlock_height` is correct for `handle-unlock`, and does not need "patched" like the others
        parsedData.balance += parsedData.locked;
      }
      return parsedData;
    }
    case Pox2EventName.StackStx: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2StackStxEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          lock_amount: BigInt(d['lock-amount'].value),
          lock_period: BigInt(d['lock-period'].value),
          start_burn_height: BigInt(d['start-burn-height'].value),
          unlock_burn_height: BigInt(d['unlock-burn-height'].value),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        parsedData.burnchain_unlock_height = parsedData.data.unlock_burn_height;
        parsedData.balance -= parsedData.data.lock_amount;
        parsedData.locked = parsedData.data.lock_amount;
      }
      return parsedData;
    }
    case Pox2EventName.StackIncrease: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2StackIncreaseEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increase_by: BigInt(d['increase-by'].value),
          total_locked: BigInt(d['total-locked'].value),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        parsedData.balance -= parsedData.data.increase_by;
        parsedData.locked += parsedData.data.increase_by;
      }
      return parsedData;
    }
    case Pox2EventName.StackExtend: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2StackExtendEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          extend_count: BigInt(d['extend-count'].value),
          unlock_burn_height: BigInt(d['unlock-burn-height'].value),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        parsedData.burnchain_unlock_height = parsedData.data.unlock_burn_height;
      }
      return parsedData;
    }
    case Pox2EventName.DelegateStx: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2DelegateStxEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          amount_ustx: BigInt(d['amount-ustx'].value),
          delegate_to: clarityPrincipalToFullAddress(d['delegate-to']),
          unlock_burn_height:
            d['unlock-burn-height'].type_id === ClarityTypeID.OptionalSome
              ? BigInt(d['unlock-burn-height'].value.value)
              : null,
        },
      };
      if (PATCH_EVENT_BALANCES) {
        if (parsedData.data.unlock_burn_height) {
          parsedData.burnchain_unlock_height = parsedData.data.unlock_burn_height;
        }
      }
      return parsedData;
    }
    case Pox2EventName.DelegateStackStx: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2DelegateStackStxEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          lock_amount: BigInt(d['lock-amount'].value),
          unlock_burn_height: BigInt(d['unlock-burn-height'].value),
          start_burn_height: BigInt(d['start-burn-height'].value),
          lock_period: BigInt(d['lock-period'].value),
          delegator: clarityPrincipalToFullAddress(d['delegator']),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        parsedData.burnchain_unlock_height = parsedData.data.unlock_burn_height;
        parsedData.balance -= parsedData.data.lock_amount;
        parsedData.locked = parsedData.data.lock_amount;
      }
      return parsedData;
    }
    case Pox2EventName.DelegateStackIncrease: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2DelegateStackIncreaseEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increase_by: BigInt(d['increase-by'].value),
          total_locked: BigInt(d['total-locked'].value),
          delegator: clarityPrincipalToFullAddress(d['delegator']),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        parsedData.balance -= parsedData.data.increase_by;
        parsedData.locked += parsedData.data.increase_by;
      }
      return parsedData;
    }
    case Pox2EventName.DelegateStackExtend: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2DelegateStackExtendEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          unlock_burn_height: BigInt(d['unlock-burn-height'].value),
          extend_count: BigInt(d['extend-count'].value),
          delegator: clarityPrincipalToFullAddress(d['delegator']),
        },
      };
      if (PATCH_EVENT_BALANCES) {
        parsedData.burnchain_unlock_height = parsedData.data.unlock_burn_height;
      }
      return parsedData;
    }
    case Pox2EventName.StackAggregationCommit: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2StackAggregationCommitEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          reward_cycle: BigInt(d['reward-cycle'].value),
          amount_ustx: BigInt(d['amount-ustx'].value),
        },
      };
      return parsedData;
    }
    case Pox2EventName.StackAggregationCommitIndexed: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2StackAggregationCommitIndexedEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          reward_cycle: BigInt(d['reward-cycle'].value),
          amount_ustx: BigInt(d['amount-ustx'].value),
        },
      };
      return parsedData;
    }
    case Pox2EventName.StackAggregationIncrease: {
      const d = eventData as Pox2PrintEventTypes[typeof eventName];
      const parsedData: DbPox2StackAggregationIncreaseEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          reward_cycle: BigInt(d['reward-cycle'].value),
          amount_ustx: BigInt(d['amount-ustx'].value),
        },
      };
      return parsedData;
    }
    default:
      throw new Error(`Unexpected PoX-2 event data name: ${opData.name.data}`);
  }
}
