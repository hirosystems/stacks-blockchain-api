/* eslint-disable prettier/prettier */
import { getJsonPathComplexity } from '../api/query-helpers';

describe('jsonpath tests', () => {

  const jsonPathVectors: [string, number][] = [
    [ '$.key', 1 ],
    [ '$.key.subkey', 2 ],
    [ '$.array[*]', 3 ],
    [ '$.array[*].subkey', 4 ],
    [ '$.key1.key2.subkey', 3 ],
    [ '$.key1.key2.array[*].subkey', 6 ],
    [ '$.key.subkey1.subkey2.subkey3.subkey4', 5 ],
    [ '$.array[*].subkey1.subkey2.subkey3.subkey4', 7 ],
    [ '$.key1.key2.subkey1.subkey2.subkey3.subkey4', 6 ],
    [ '$.key1.key2.array[*].subkey1.subkey2.subkey3.subkey4', 9 ],
    [ '$.store.book[*].author', 5 ],
    [ '$.store.book[*].title', 5 ],
    [ '$.store.book[0,1].title', 8 ],
    [ '$.store.book[0:2].title', 5 ],
    [ '$.store.book[-1:].title', 5 ],
    [ '$.store.book[-2].author', 4 ],
    [ '$.store..price', 2 ],
    [ '$..book[2]', 2 ],
    [ '$..book[-2]', 2 ],
    [ '$..book[0,1]', 6 ],
    [ '$..book[:2]', 3 ],
    [ '$..book[1:2]', 3 ],
    [ '$..book[-2:]', 3 ],
    [ '$..book[2:]', 3 ],
    [ '$.store.book[?(@.isbn)]', 5 ],
    [ '$..book[?(@.price<10)]', 6 ],
    [ '$..book[?(@.price==8.95)]', 6 ],
    [ '$..book[?(@.price!=8.95)]', 6 ],
    [ '$..book[?(@.price<30 && @.category=="fiction")]', 10 ],
    [ '$..book[?(@.price<30 || @.category=="fiction")]', 10 ],
    [ '$.store.book[0:2].author[0:3].name[0:3].title', 11 ],
    [ '$.store..author[0:2].books[0:2].title', 8 ],
    [ '$.store.book[?(@.isbn)].publisher[0:2].name', 9 ],
    [ '$.store.book[?(@.price<10)].author[0:2].books[0:2].title', 14 ],
    [ '$..book[0:2].author[0:3].name[0:3].title', 10 ],
    [ '$..book[-2:].author[0:3].name[0:3].title', 10 ],
    [ '$..book[2:].author[0:3].name[0:3].title', 10 ],
    [ '$..book[?(@.price<30 && @.category=="fiction")].author[0:2].books[0:2].title', 17 ],
    [ '$..book[?(@.price<30 || @.category=="fiction")].author[0:2].books[0:2].title', 17 ],
    [ '$.store.book[0:2].title[0:3].author[0:3].name', 11 ],
    [ '$.store.book[?(@.isbn)].publisher[0:2].name[0:3].address', 12 ],
    [ '$..book[0:2].title[0:3].author[0:3].name[0:3].address', 13 ],
    [ '$..book[-2:].title[0:3].author[0:3].name[0:3].address', 13 ],
    [ '$..book[2:].title[0:3].author[0:3].name[0:3].address', 13 ],
    [ '$..book[?(@.price<30 && @.category=="fiction")].title[0:3].author[0:2].name[0:3].address', 20 ],
    [ '$..book[?(@.price<30 || @.category=="fiction")].title[0:3].author[0:2].name[0:3].address', 20 ],
    [ '$.store..author[0:2].books[0:2].title[0:3].publisher[0:2].name', 14 ],
    [ '$.store.book[?(@.isbn)].publisher[0:2].name[0:3].address[0:2].city', 15 ],
  ];

  test.each(jsonPathVectors)('test jsonpath operation complexity: %p', (input, operations) => {
    const complexity = getJsonPathComplexity(input);
    expect(complexity).toEqual({ operations });
  });

  /*
  test.skip('generate vector data', () => {
    const result = postgresExampleVectors.map(([input]) => {
      const complexity = getJsonPathComplexity(input);
      if ('error' in complexity) {
        return [input, complexity.error.message];
      }
      return [input, complexity.operations];
    });
    console.log(result);
  });
  */

});
