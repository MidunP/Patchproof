/**
 * User profile utilities.
 *
 * Bug: getDisplayName does not handle null/undefined user — throws
 * "Cannot read properties of null" instead of returning a default.
 */
export interface User {
  id: number;
  name: string | null;
  email: string;
}

export function getDisplayName(user: User | null | undefined): string {
  // BUG: missing null check — throws if user is null/undefined
  return user!.name || user!.email;
}

export function formatUserList(users: Array<User | null>): string[] {
  // BUG: missing null guard — crashes if any user in array is null
  return users.map(u => getDisplayName(u as User));
}
