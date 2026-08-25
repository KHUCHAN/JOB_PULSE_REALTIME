-- Keep the runtime catalog bootstrap from rewriting all 1,455 sources after
-- this bounded catalog repair has already been applied by the deployment.
INSERT INTO catalog_state (key, value, updated_at)
VALUES ('sources', 'v2:sha256:aaf98b2259fcc657ed2ff5cd76516d34ab726591d6ec89d04afcdd435a428c37', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM catalog_state
WHERE key = 'sources_sync_lock_v1';
