/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable prettier/prettier */
import { containsDisallowedJsonPathOperation } from '../api/query-helpers';

describe('jsonpath tests', () => {

  const jsonPathVectors: [string, string | null][] = [
    [ '$.track.segments.location', null ],
    [ '$[0] + 3', null ],
    [ '+ $.x', null ],
    [ '7 - $[0]', null ],
    [ '- $.x', null ],
    [ '2 * $[0]', null ],
    [ '$[0] / 2', null ],
    [ '$[0] % 10', null ],
    [ '$.**.HR', '.* wildcard accessor' ],
    [ '$.* ? (@.v == "a")', '.* wildcard accessor' ],
    [ '$.** ? (@.v == "a")', '.* wildcard accessor' ],
    [ '$.track.segments[*].location', '[*] wildcard array accessor' ],
    [ '$.[1 to 37634].a', '[n to m] array range accessor' ],
    [ '$.[555 to last].a', '[n to m] array range accessor' ],
    [ '$.[(3 + 4) to last].a', '[()] array expression accessor' ],
    [ '$.[1 to (3 + 4)].a', '[()] array expression accessor' ],
    [ '$.t.type()', '.type()' ],
    [ '$.m.size()', '.size()' ],
    [ '$.len.double() * 2', '.double()' ],
    [ '$.h.ceiling()', '.ceiling()' ],
    [ '$.h.floor()', '.floor()' ],
    [ '$.z.abs()', '.abs()' ],
    [ '$.a ? (@.datetime() < "2015-08-2".datetime())', '.datetime()' ],
    [ '$.a.datetime("HH24:MI")', '.datetime()' ],
    [ '$.keyvalue()', '.keyvalue()' ],
    [ '$.a ? (@ like_regex "^abc")', 'like_regex' ],
    [ '$.a ? (@ starts with "John")', 'starts with' ],
    [ '$.a ? ((@ > 0) is unknown)', 'is unknown' ]
  ];

  test.each(jsonPathVectors)('test jsonpath operation complexity: %p', (input, result) => {
    const disallowed = containsDisallowedJsonPathOperation(input);
    expect(disallowed).toEqual(result === null ? false : { operation: result });
  });

  /*
  test('generate vector data', () => {
    const result = postgresExampleVectors.map((input) => {
      const complexity = containsDisallowedJsonPathOperation(input);
      return [input, complexity ? complexity.operation : null];
    });
    console.log(result);
  });
  */

});
