-- Keep the runtime catalog bootstrap from rewriting all 1,455 sources after
-- this bounded catalog repair has already been applied by the deployment.
INSERT INTO catalog_state (key, value, updated_at)
VALUES ('sources', 'v2:sha256:725408bf8a97b597d0522e3f83ed12d16d16e4ccd04bc964891451689a2ed5ce', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM catalog_state
WHERE key = 'sources_sync_lock_v1';
