-- Keep the runtime catalog bootstrap from rewriting all 1,455 sources after
-- this bounded catalog repair has already been applied by the deployment.
INSERT INTO catalog_state (key, value, updated_at)
VALUES ('sources', 'v2:sha256:3c96ce5c9869f9e55a02e35f657d2dff7e36e650469a9b1f36fa434128a5aa03', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM catalog_state
WHERE key = 'sources_sync_lock_v1';
