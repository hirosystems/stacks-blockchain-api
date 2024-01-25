import {
  DbPoxSyntheticBaseEventData,
  DbPoxSyntheticDelegateStackExtendEvent,
  DbPoxSyntheticDelegateStackIncreaseEvent,
  DbPoxSyntheticDelegateStackStxEvent,
  DbPoxSyntheticDelegateStxEvent,
  DbPoxSyntheticEventData,
  DbPoxSyntheticHandleUnlockEvent,
  DbPoxSyntheticRevokeDelegateStxEvent,
  DbPoxSyntheticStackAggregationCommitEvent,
  DbPoxSyntheticStackAggregationCommitIndexedEvent,
  DbPoxSyntheticStackAggregationIncreaseEvent,
  DbPoxSyntheticStackExtendEvent,
  DbPoxSyntheticStackIncreaseEvent,
  DbPoxSyntheticStackStxEvent,
} from '../datastore/common';
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
import { SyntheticPoxEventName } from '../pox-helpers';
import { logger } from '../logger';
import { bufferToHex, coerceToBuffer } from '@hirosystems/api-toolkit';

function tryClarityPoxAddressToBtcAddress(
  poxAddr:
    | PoxSyntheticEventAddr
    | ClarityValueOptionalSome<PoxSyntheticEventAddr>
    | ClarityValueOptionalNone,
  network: 'mainnet' | 'testnet' | 'devnet' | 'mocknet'
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
    logger.debug(
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

type PoxSyntheticEventAddr = ClarityValueTuple<{
  hashbytes: ClarityValueBuffer;
  version: ClarityValueBuffer;
}>;

type PoXSyntheticEventData = ClarityValueTuple<{
  name: ClarityValueStringAscii;
  balance: ClarityValueUInt;
  stacker: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  locked: ClarityValueUInt;
  'burnchain-unlock-height': ClarityValueUInt;
  data: ClarityValueTuple;
}>;

interface PoxSyntheticPrintEventTypes {
  [SyntheticPoxEventName.HandleUnlock]: {
    'first-cycle-locked': ClarityValueUInt;
    'first-unlocked-cycle': ClarityValueUInt;
  };
  [SyntheticPoxEventName.StackStx]: {
    'lock-amount': ClarityValueUInt;
    'lock-period': ClarityValueUInt;
    'pox-addr': PoxSyntheticEventAddr;
    'start-burn-height': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
  };
  [SyntheticPoxEventName.StackIncrease]: {
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
  };
  [SyntheticPoxEventName.StackExtend]: {
    'extend-count': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
    'pox-addr': PoxSyntheticEventAddr;
  };
  [SyntheticPoxEventName.DelegateStx]: {
    'amount-ustx': ClarityValueUInt;
    'delegate-to': ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
    'unlock-burn-height': ClarityValueOptionalSome<ClarityValueUInt> | ClarityValueOptionalNone;
    'pox-addr': PoxSyntheticEventAddr | ClarityValueOptionalNone;
  };
  [SyntheticPoxEventName.DelegateStackStx]: {
    'lock-amount': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
    'pox-addr': PoxSyntheticEventAddr;
    'start-burn-height': ClarityValueUInt;
    'lock-period': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  [SyntheticPoxEventName.DelegateStackIncrease]: {
    'pox-addr': PoxSyntheticEventAddr;
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  [SyntheticPoxEventName.DelegateStackExtend]: {
    'pox-addr': PoxSyntheticEventAddr;
    'unlock-burn-height': ClarityValueUInt;
    'extend-count': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  [SyntheticPoxEventName.StackAggregationCommit]: {
    'pox-addr': PoxSyntheticEventAddr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
  [SyntheticPoxEventName.StackAggregationCommitIndexed]: {
    'pox-addr': PoxSyntheticEventAddr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
  [SyntheticPoxEventName.StackAggregationIncrease]: {
    'pox-addr': PoxSyntheticEventAddr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
  [SyntheticPoxEventName.RevokeDelegateStx]: {
    'delegate-to': ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
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

export function decodePoxSyntheticPrintEvent(
  rawClarityData: string,
  network: 'mainnet' | 'testnet' | 'devnet' | 'mocknet'
): DbPoxSyntheticEventData | null {
  const decoded = decodeClarityValue<ClarityValueResponse>(rawClarityData);
  if (decoded.type_id === ClarityTypeID.ResponseError) {
    logger.info(`Received ResponseError when decoding Pox synthetic print event: ${decoded.repr}`);
    return null;
  }
  if (decoded.type_id !== ClarityTypeID.ResponseOk) {
    const valCommon: ClarityValueAbstract = decoded;
    throw new Error(
      `Unexpected PoX synthetic event Clarity type ID, expected ResponseOk, got ${valCommon.type_id}: ${valCommon.repr}`
    );
  }
  if (decoded.value.type_id !== ClarityTypeID.Tuple) {
    throw new Error(
      `Unexpected PoX synthetic event Clarity type ID, expected Tuple, got ${decoded.value.type_id}`
    );
  }
  const opData = (decoded.value as PoXSyntheticEventData).data;

  const baseEventData: DbPoxSyntheticBaseEventData = {
    stacker: clarityPrincipalToFullAddress(opData.stacker),
    locked: BigInt(opData.locked.value),
    balance: BigInt(opData.balance.value),
    burnchain_unlock_height: BigInt(opData['burnchain-unlock-height'].value),
    pox_addr: null,
    pox_addr_raw: null,
  };

  const eventName = opData.name.data as keyof PoxSyntheticPrintEventTypes;
  if (opData.name.type_id !== ClarityTypeID.StringAscii) {
    throw new Error(
      `Unexpected PoX synthetic event name type, expected StringAscii, got ${opData.name.type_id}`
    );
  }

  const eventData = opData.data.data;
  if (opData.data.type_id !== ClarityTypeID.Tuple) {
    throw new Error(
      `Unexpected PoX synthetic event data payload type, expected Tuple, got ${opData.data.type_id}`
    );
  }

  if ('pox-addr' in eventData) {
    const eventPoxAddr = eventData['pox-addr'] as
      | PoxSyntheticEventAddr
      | ClarityValueOptionalSome<PoxSyntheticEventAddr>
      | ClarityValueOptionalNone;
    const encodedArr = tryClarityPoxAddressToBtcAddress(eventPoxAddr, network);
    baseEventData.pox_addr = encodedArr.btcAddr;
    baseEventData.pox_addr_raw = bufferToHex(encodedArr.raw);
  }

  switch (eventName) {
    case SyntheticPoxEventName.HandleUnlock: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticHandleUnlockEvent = {
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
    case SyntheticPoxEventName.StackStx: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticStackStxEvent = {
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
    case SyntheticPoxEventName.StackIncrease: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticStackIncreaseEvent = {
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
    case SyntheticPoxEventName.StackExtend: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticStackExtendEvent = {
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
    case SyntheticPoxEventName.DelegateStx: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticDelegateStxEvent = {
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
    case SyntheticPoxEventName.DelegateStackStx: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticDelegateStackStxEvent = {
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
    case SyntheticPoxEventName.DelegateStackIncrease: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticDelegateStackIncreaseEvent = {
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
    case SyntheticPoxEventName.DelegateStackExtend: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticDelegateStackExtendEvent = {
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
    case SyntheticPoxEventName.StackAggregationCommit: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticStackAggregationCommitEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          reward_cycle: BigInt(d['reward-cycle'].value),
          amount_ustx: BigInt(d['amount-ustx'].value),
        },
      };
      return parsedData;
    }
    case SyntheticPoxEventName.StackAggregationCommitIndexed: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticStackAggregationCommitIndexedEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          reward_cycle: BigInt(d['reward-cycle'].value),
          amount_ustx: BigInt(d['amount-ustx'].value),
        },
      };
      return parsedData;
    }
    case SyntheticPoxEventName.StackAggregationIncrease: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticStackAggregationIncreaseEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          reward_cycle: BigInt(d['reward-cycle'].value),
          amount_ustx: BigInt(d['amount-ustx'].value),
        },
      };
      return parsedData;
    }
    case SyntheticPoxEventName.RevokeDelegateStx: {
      const d = eventData as PoxSyntheticPrintEventTypes[typeof eventName];
      const parsedData: DbPoxSyntheticRevokeDelegateStxEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          delegate_to: clarityPrincipalToFullAddress(d['delegate-to']),
        },
      };
      return parsedData;
    }
    default:
      throw new Error(`Unexpected PoX synthetic event data name: ${opData.name.data}`);
  }
}
