/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable prettier/prettier */
import jsonpathToAst from 'jsonpath-pg';
import { calculateJsonpathComplexity } from '../api/query-helpers';

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
    [ '$[1,3,4,6]', null ],
    [ '$[555 to LAST]', '[n to m] array range accessor' ],
    [ '$[1 to 37634].a', '[n to m] array range accessor' ],
    [ '$[3,4 to last].a', '[n to m] array range accessor' ],
    [ '$[(3 + 4) to last].a', '[n to m] array range accessor' ],
    [ '$[1 to (3 + 4)].a', '[n to m] array range accessor' ],
    [ '$.**.HR', '.**' ],
    [ '$.* ? (@.v == "a")', '.*' ],
    [ '$.** ? (@.v == "a")', '.**' ],
    [ '$.track.segments[*].location', '[*]' ],
    [ '$.t.type()', 'type' ],
    [ '$.m.size()', 'size' ],
    [ '$.len.double() * 2', 'double' ],
    [ '$.h.ceiling()', 'ceiling' ],
    [ '$.h.floor()', 'floor' ],
    [ '$.z.abs()', 'abs' ],
    [ '$.a ? (@.datetime() < "2015-08-2".datetime())', 'datetime' ],
    [ '$.a.datetime("HH24:MI")', 'datetime' ],
    [ '$.keyvalue()', 'keyvalue' ],
    [ '$.a ? (@ like_regex "^abc")', 'like_regex' ],
    [ '$.a ? (@ starts with "John")', 'starts with' ],
    [ '$.a ? ((@ > 0) is unknown)', 'is_unknown' ]
  ];

  test.each(jsonPathVectors)('test jsonpath operation complexity: %p', (input, result) => {
    const ast = jsonpathToAst(input);
    const disallowed = calculateJsonpathComplexity(ast);
    if (typeof disallowed === 'number') {
      expect(result).toBe(null);
    } else {
      expect(disallowed.disallowedOperation).toBe(result);
    }
  });

  test.skip('generate vector data', () => {
    const result = jsonPathVectors.map(([input]) => {
      const ast = jsonpathToAst(input);
      const complexity = calculateJsonpathComplexity(ast);
      return [input, typeof complexity !== 'number' ? complexity.disallowedOperation : null];
    });
    console.log(result);
  });

});
