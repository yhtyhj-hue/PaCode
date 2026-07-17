# cross-module

模块契约不一致：

- `src/store.js` 的 `getUser()` 返回 `{ fullName, ageYears }`
- `src/format.js` 的 `label(user)` 期望 `{ name, age }`（age 为 number）

对齐契约（可改任一侧或两侧），使 `verify.mjs` 通过。保持导出函数名不变。
