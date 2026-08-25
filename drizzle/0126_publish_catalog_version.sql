-- Keep the runtime catalog bootstrap from rewriting all 1,455 sources after
-- this bounded catalog repair has already been applied by the deployment.
INSERT INTO catalog_state (key, value, updated_at)
VALUES ('sources', 'v2:sha256:522902062828d40eae45c5c724e578c8cc9a0e55d82e85afd090c930c1b8e637', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM catalog_state
WHERE key = 'sources_sync_lock_v1';
