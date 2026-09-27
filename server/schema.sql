-- server/schema.sql — Autotunnel D1 结构(IF NOT EXISTS 幂等, 可重复执行)
-- worker 核心存储接口为 KV(get/put/delete); D1 模式下由运行时适配层
-- (src/lib/adapter/storage.ts)将 KV 语义映射到 kv 表。
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_kv_updated_at ON kv (updated_at);
