import { describe, expect, it } from 'vitest';
import { selectTopCreatives, type CreativeCandidate } from './creative-selection.js';

const C = (id: string, purchases: number, value = 0): CreativeCandidate => ({
  meta_creative_id: id,
  purchases,
  purchase_value_cents: value,
});

describe('selectTopCreatives', () => {
  it('returns the top-N creatives ranked by purchases (desc)', () => {
    const winners = selectTopCreatives([C('a', 3), C('b', 10), C('c', 7)], 2);
    expect(winners.map((w) => w.meta_creative_id)).toEqual(['b', 'c']);
  });

  it('excludes creatives with zero purchases (only proven winners)', () => {
    const winners = selectTopCreatives([C('a', 0), C('b', 5), C('c', 0)], 3);
    expect(winners.map((w) => w.meta_creative_id)).toEqual(['b']);
  });

  it('breaks ties by purchase value then by id (deterministic)', () => {
    const winners = selectTopCreatives([C('z', 5, 100), C('a', 5, 100), C('m', 5, 200)], 3);
    expect(winners.map((w) => w.meta_creative_id)).toEqual(['m', 'a', 'z']);
  });

  it('returns fewer than N when fewer winners exist', () => {
    const winners = selectTopCreatives([C('a', 2), C('b', 0)], 5);
    expect(winners).toHaveLength(1);
  });

  it('returns an empty array when no creative has purchases', () => {
    expect(selectTopCreatives([C('a', 0), C('b', 0)], 3)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [C('a', 1), C('b', 2)];
    const snapshot = input.map((c) => c.meta_creative_id);
    selectTopCreatives(input, 1);
    expect(input.map((c) => c.meta_creative_id)).toEqual(snapshot);
  });

  it('rejects a non-positive or non-integer topN', () => {
    expect(() => selectTopCreatives([C('a', 1)], 0)).toThrow(/positive integer/);
    expect(() => selectTopCreatives([C('a', 1)], -1)).toThrow(/positive integer/);
    expect(() => selectTopCreatives([C('a', 1)], 1.5)).toThrow(/positive integer/);
  });
});
