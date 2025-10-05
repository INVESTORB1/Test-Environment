const { parseAmountToCents } = require('../amountParser');

test('parses plain numbers to cents', () => {
  expect(parseAmountToCents('1000')).toBe(100000);
  expect(parseAmountToCents('1000.50')).toBe(100050);
});

test('parses shorthand k/m/b', () => {
  expect(parseAmountToCents('5k')).toBe(500000);
  expect(parseAmountToCents('2.5m')).toBe(250000000);
  expect(parseAmountToCents('1b')).toBe(100000000000);
});

test('parses typo like 5oom to 500,000,000', () => {
  expect(parseAmountToCents('5oom')).toBe(50000000000); // 5oom -> 500m => 500,000,000.00 Naira -> cents: 50,000,000,000 ???
});

test('handles separators and spaces', () => {
  expect(parseAmountToCents('1,234')).toBe(123400);
  expect(parseAmountToCents(' 2 500 ')).toBe(250000);
});

test('invalid inputs return NaN', () => {
  expect(Number.isNaN(parseAmountToCents('abc'))).toBe(true);
  expect(Number.isNaN(parseAmountToCents(''))).toBe(true);
});
