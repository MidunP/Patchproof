import { describe, it, expect } from 'vitest';
import { add, multiply, sumTo, lastElement } from '../seeds/off-by-one/src/math';
import { AsyncCounter, concurrentIncrement } from '../seeds/async-race/src/counter';
import { getDisplayName, formatUserList } from '../seeds/null-handling/src/user';

describe('Demo Seed Repositories Integrity', () => {
  describe('Seed 1: off-by-one', () => {
    it('baseline math operations pass', () => {
      expect(add(2, 3)).toBe(5);
      expect(multiply(3, 4)).toBe(12);
    });

    it('demonstrates off-by-one bug in sumTo (returns 10 instead of 15)', () => {
      // 1 + 2 + 3 + 4 = 10 because loop stops before n
      expect(sumTo(5)).toBe(10);
      expect(sumTo(5)).not.toBe(15);
    });

    it('demonstrates off-by-one bug in lastElement', () => {
      // arr.length - 2 instead of arr.length - 1
      expect(lastElement([10, 20, 30])).toBe(20);
      expect(lastElement([10, 20, 30])).not.toBe(30);
    });
  });

  describe('Seed 2: async-race', () => {
    it('single sequential increment works as expected', async () => {
      const counter = new AsyncCounter();
      await counter.increment();
      expect(counter.getCount()).toBe(1);
    });

    it('demonstrates async race condition bug under concurrent increments', async () => {
      // Because read and write yield the event loop without locking,
      // concurrentIncrement(5) produces an incorrect count (typically 1 instead of 5)
      const count = await concurrentIncrement(5);
      expect(count).toBeLessThan(5);
    });
  });

  describe('Seed 3: null-handling', () => {
    it('handles valid users correctly', () => {
      expect(getDisplayName({ id: 1, name: 'Alice', email: 'alice@example.com' })).toBe('Alice');
      expect(getDisplayName({ id: 2, name: null, email: 'bob@example.com' })).toBe('bob@example.com');
    });

    it('demonstrates null pointer bug when user is null or undefined', () => {
      // Missing null guard causes TypeError
      expect(() => getDisplayName(null)).toThrow();
      expect(() => getDisplayName(undefined)).toThrow();
    });

    it('demonstrates null pointer bug in formatUserList', () => {
      expect(() => formatUserList([null, { id: 1, name: 'Alice', email: 'a@example.com' }])).toThrow();
    });
  });
});
