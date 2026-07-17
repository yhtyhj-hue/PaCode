import { add, mul } from './math.js';

export function mean(nums) {
  if (!Array.isArray(nums) || nums.length === 0) return 0;
  let sum = 0;
  for (const n of nums) sum = add(sum, n);
  return sum / nums.length;
}

export function scale(nums, factor) {
  return nums.map((n) => mul(n, factor));
}
