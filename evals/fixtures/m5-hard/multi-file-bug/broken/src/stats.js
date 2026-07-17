import { add, mul } from './math.js';

export function mean(nums) {
  if (!Array.isArray(nums) || nums.length === 0) return 0;
  let sum = 0;
  for (const n of nums) sum = add(sum, n);
  // BUG: 除以 length+1
  return sum / (nums.length + 1);
}

export function scale(nums, factor) {
  return nums.map((n) => mul(n, factor));
}
