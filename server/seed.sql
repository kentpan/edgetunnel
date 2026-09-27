-- server/seed.sql — Autotunnel D1 种子(INSERT OR IGNORE 幂等)
-- 说明: worker 核心在首次读取时自动写入默认 config.json/cf.json/tg.json
-- (与 host/UA 相关, 无法静态预置), 此处仅写入版本标记。
INSERT OR IGNORE INTO kv (key, value) VALUES ('_meta', '{"project":"autotunnel","version":"1.0.0"}');
