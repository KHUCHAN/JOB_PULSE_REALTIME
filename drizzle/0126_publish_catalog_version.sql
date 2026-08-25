-- Keep the runtime catalog bootstrap from rewriting all 1,455 sources after
-- this bounded catalog repair has already been applied by the deployment.
INSERT INTO catalog_state (key, value, updated_at)
VALUES ('sources', 'v2:sha256:7976ec71ac7cdce3e601c6fc14f0444ee847fbc51b73ad64bf25ab460838b58c', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM catalog_state
WHERE key = 'sources_sync_lock_v1';
