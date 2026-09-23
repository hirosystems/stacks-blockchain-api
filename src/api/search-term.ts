/**
 * Maximum number of results the search endpoint returns. The endpoint is not paginated: a search
 * either surfaces the entity the caller is looking for near the top or the term needs to be more
 * specific, so there is nothing useful to page through.
 */
export const SEARCH_RESULT_LIMIT = 20;

/**
 * Minimum length of a hex term. Eight hex characters pin down four bytes, which is selective
 * enough that a prefix scan over a table with billions of rows still touches only a handful.
 */
export const SEARCH_MIN_HASH_LENGTH = 8;

/** Minimum length of an address term, which bounds the prefix scan the same way. */
export const SEARCH_MIN_ADDRESS_LENGTH = 6;

/** Minimum length of a name term (contract or asset name). */
export const SEARCH_MIN_NAME_LENGTH = 3;

/** Largest value storable in the `int4` block height columns. */
const MAX_BLOCK_HEIGHT = 2_147_483_647;

const HEX_TERM = /^(?:0x)?[0-9a-f]+$/i;
const DIGITS_TERM = /^[0-9]+$/;
const C32_TERM = /^S[0123456789ABCDEFGHJKMNPQRSTVWXYZ]*$/;
const CLARITY_NAME_TERM = /^[a-zA-Z](?:[a-zA-Z0-9]|[-_!?+<>=/*])*$/;

/**
 * How closely a result matched the search term. Used to rank results; it is deliberately not part
 * of the API response, so result shapes stay free to change independently of how they were found.
 */
export type SearchMatchQuality = 'exact' | 'prefix' | 'fuzzy';

/** A term that can be matched against 32-byte hash columns. */
export interface SearchTermHash {
  quality: Extract<SearchMatchQuality, 'exact' | 'prefix'>;
  /** Inclusive lower bound of the hash range, `0x`-prefixed. */
  lower: string;
  /** Inclusive upper bound of the hash range, `0x`-prefixed. */
  upper: string;
}

/**
 * How a text term is matched against a column: from the start, or anywhere within it.
 *
 * Whether a match turns out to be exact is decided per result rather than here, because a term
 * cannot be told apart from a complete identifier by its syntax alone — `SP2C2….arkadi` is both a
 * valid contract id and the beginning of a longer one, so both are searched for and any result
 * equal to the term is ranked as exact.
 */
export type SearchTextMatchMode = 'prefix' | 'fuzzy';

/** A term that can be matched against a text column. */
export interface SearchTermText {
  mode: SearchTextMatchMode;
  value: string;
}

/**
 * The entity classes a search term belongs to. A term can belong to several at once — `abcd1234`
 * is both a plausible hash prefix and a plausible contract-name fragment — in which case every
 * matching class is searched and the results are merged, rather than guessing at one intent.
 */
export interface SearchTerm {
  hash?: SearchTermHash;
  blockHeight?: number;
  address?: SearchTermText;
  smartContract?: SearchTermText;
  token?: SearchTermText;
}

/** Uppercases the address portion of a principal-shaped term, leaving any name portion alone. */
function normalizePrincipalTerm(value: string): string {
  const dot = value.indexOf('.');
  return dot === -1 ? value.toUpperCase() : value.slice(0, dot).toUpperCase() + value.slice(dot);
}

/**
 * Classifies a raw search term into the entity classes worth querying for it.
 *
 * Classification is purely syntactic: it decides which tables a term could possibly match and how
 * (exact, prefix, or substring), so the search never runs a query a term cannot satisfy. A term
 * that matches no class at all (or that is too short for every class it would otherwise match)
 * classifies as nothing, which the endpoint reports as a bad request.
 * @param rawTerm - The caller's search term.
 * @returns The classes to search, or null when the term matches none.
 */
export function classifySearchTerm(rawTerm: string): SearchTerm | null {
  const term = rawTerm.trim();
  if (term.length === 0) {
    return null;
  }
  const result: SearchTerm = {};

  const hasHexPrefix = term.startsWith('0x') || term.startsWith('0X');
  const hex = (hasHexPrefix ? term.slice(2) : term).toLowerCase();
  const isHexTerm = hex.length > 0 && HEX_TERM.test(term);
  const isFullHash = isHexTerm && hex.length === 64;
  // Only a `0x`-prefixed full hash is unambiguously a hash. A bare 64-character hex string is also
  // a syntactically valid Clarity asset name, so it still gets searched as a name.
  const isUnambiguousHash = isFullHash && hasHexPrefix;
  if (isHexTerm && hex.length >= SEARCH_MIN_HASH_LENGTH && hex.length <= 64) {
    // An odd-length prefix is padded out to both ends of the range it covers, so `0xabc` matches
    // every hash from `0xabc0…0` through `0xabcf…f`.
    result.hash = {
      quality: isFullHash ? 'exact' : 'prefix',
      lower: `0x${hex.padEnd(64, '0')}`,
      upper: `0x${hex.padEnd(64, 'f')}`,
    };
  }

  if (DIGITS_TERM.test(term)) {
    const height = Number(term);
    if (Number.isSafeInteger(height) && height <= MAX_BLOCK_HEIGHT) {
      result.blockHeight = height;
    }
  }

  // Standard addresses only. A contract principal is technically a principal too, but it is
  // classified as a smart contract below so that the two result types stay disjoint.
  if (!term.includes('.')) {
    const address = term.toUpperCase();
    if (
      C32_TERM.test(address) &&
      address.length >= SEARCH_MIN_ADDRESS_LENGTH &&
      address.length <= 41
    ) {
      result.address = { mode: 'prefix', value: address };
    }
  }

  if (!isUnambiguousHash) {
    // The portion before `::` names a contract, so `…token::diko` searches for the defining
    // contract as well as the asset.
    const separator = term.indexOf('::');
    const contractTerm = separator === -1 ? term : term.slice(0, separator);
    if (contractTerm.includes('.')) {
      const value = normalizePrincipalTerm(contractTerm);
      const [addressPart] = value.split('.');
      if (C32_TERM.test(addressPart)) {
        result.smartContract = { mode: 'prefix', value };
      }
    } else if (
      contractTerm.length >= SEARCH_MIN_NAME_LENGTH &&
      CLARITY_NAME_TERM.test(contractTerm)
    ) {
      result.smartContract = { mode: 'fuzzy', value: contractTerm };
    }

    if (term.includes('.')) {
      const value = normalizePrincipalTerm(term);
      const [addressPart] = value.split('.');
      if (C32_TERM.test(addressPart)) {
        result.token = { mode: 'prefix', value };
      }
    } else if (term.length >= SEARCH_MIN_NAME_LENGTH) {
      // An asset name on its own, or a `contract::asset` fragment with no address in front of it,
      // can only be found by substring.
      const nameTerm = separator === -1 ? term : term.slice(separator + 2);
      if (CLARITY_NAME_TERM.test(nameTerm) && CLARITY_NAME_TERM.test(contractTerm)) {
        result.token = { mode: 'fuzzy', value: term };
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
