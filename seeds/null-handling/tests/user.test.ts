import { describe, it, expect } from 'vitest';
import { getDisplayName, formatUserList } from '../src/user';

describe('user utils', () => {
  it('returns name when present', () => {
    expect(getDisplayName({ id: 1, name: 'Alice', email: 'alice@example.com' })).toBe('Alice');
  });

  it('falls back to email when name is null', () => {
    expect(getDisplayName({ id: 2, name: null, email: 'bob@example.com' })).toBe('bob@example.com');
  });
});
