#!/usr/bin/env node
/**
 * npm bin 入口 — 独立可执行 shim，避免 publish 时 strip ./dist 导致 bin 被剔除
 */
import '../dist/cli/index.js';
