import { describe, it, expect } from 'vitest';
import { AsyncCounter } from '../src/counter';

describe('AsyncCounter', () => {
  it('single increment works', async () => {
    const counter = new AsyncCounter();
    await counter.increment();
    expect(counter.getCount()).toBe(1);
  });
});
