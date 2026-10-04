// Stories are assigned to shards by a hash of their id, not by Playwright's --shard, so a story
// stays in the same shard for the base and head builds even when the two story lists differ.

/**
 * 32-bit FNV-1a hash of a string's UTF-16 code units.
 * @param {string} value
 */
export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

/**
 * 1-based shard index of a story.
 * @param {string} storyId
 * @param {number} total
 */
export function shardOf(storyId, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Invalid shard total: ${total}`);
  return (fnv1a(storyId) % total) + 1;
}

/**
 * Parses "<index>/<total>" (VISUAL_SHARD), e.g. "2/4".
 * @param {string | undefined} value
 */
export function parseShard(value = '1/1') {
  const match = /^(\d+)\/(\d+)$/.exec(String(value).trim());
  const index = match ? Number(match[1]) : NaN;
  const total = match ? Number(match[2]) : NaN;
  if (!match || total < 1 || index < 1 || index > total) {
    throw new Error(`Invalid shard "${value}": expected <index>/<total> with 1 <= index <= total`);
  }
  return { index, total };
}
