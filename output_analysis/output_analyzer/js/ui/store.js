// Session storage through localStorage, with every access in try/catch:
// a private window, blocked site data, or a sandboxed frame can make the
// accessor throw or the quota refuse a write, and the page has to keep
// working on data held in memory either way.

const PREFIX = 'output-analyzer:';
let availableCache = null;

/**
 * Whether localStorage can be written and read back in this context.
 * @returns {boolean}
 */
export function available() {
  if (availableCache !== null) return availableCache;
  try {
    const ls = globalThis.localStorage;
    if (!ls) return (availableCache = false);
    const k = PREFIX + '__probe__';
    ls.setItem(k, '1');
    const ok = ls.getItem(k) === '1';
    ls.removeItem(k);
    availableCache = ok;
  } catch (err) {
    availableCache = false;
  }
  return availableCache;
}

/**
 * Saves a JSON-serializable value under `key`.
 * @param {string} key
 * @param {*} obj
 * @returns {boolean} whether the write succeeded (false when storage is
 *   unavailable or full)
 */
export function save(key, obj) {
  try {
    globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(obj));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Loads the value saved under `key`.
 * @param {string} key
 * @returns {*} the parsed value, or null when absent, unreadable, or not JSON
 */
export function load(key) {
  try {
    const s = globalThis.localStorage.getItem(PREFIX + key);
    return s === null ? null : JSON.parse(s);
  } catch (err) {
    return null;
  }
}

/**
 * Removes the value saved under `key`.
 * @param {string} key
 * @returns {boolean} whether the removal succeeded
 */
export function removeKey(key) {
  try {
    globalThis.localStorage.removeItem(PREFIX + key);
    return true;
  } catch (err) {
    return false;
  }
}
