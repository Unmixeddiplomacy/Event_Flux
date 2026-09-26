const STORAGE_KEY = 'my_studio_matches';

/**
 * Retrieves the set of match IDs created in this browser session from localStorage.
 */
export const getMyMatchIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
};

/**
 * Stores a new match ID into localStorage.
 */
export const addMyMatchId = (id: string | number): void => {
  try {
    const current = getMyMatchIds();
    current.add(String(id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(current)));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('my_studio_matches_updated', { detail: { id: String(id) } }));
    }
  } catch (e) {
    console.error('Failed to save match ID to localStorage:', e);
  }
};

/**
 * Checks if a match was created in this browser session.
 */
export const isMyMatch = (id: string | number): boolean => {
  if (!id) return false;
  return getMyMatchIds().has(String(id));
};
