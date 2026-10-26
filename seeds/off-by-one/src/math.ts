/**
 * Basic math utilities.
 */
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * Returns the sum of all integers from 1 to n (inclusive).
 * Bug: uses < instead of <= causing off-by-one — misses the last element.
 */
export function sumTo(n: number): number {
  let total = 0;
  for (let i = 1; i < n; i++) {  // BUG: should be i <= n
    total += i;
  }
  return total;
}

/**
 * Returns the last element of an array.
 * Bug: uses length - 2 instead of length - 1.
 */
export function lastElement<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[arr.length - 2]; // BUG: should be arr.length - 1
}
