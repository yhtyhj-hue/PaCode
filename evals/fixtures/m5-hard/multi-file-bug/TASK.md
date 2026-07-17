# multi-file-bug

两个文件都有 bug：

1. `src/math.js` 的 `mul(a, b)` 算错了
2. `src/stats.js` 的 `mean(nums)` 用错了长度（off-by-one）

修好使根目录 `verify.mjs` 通过。只改必要代码。
