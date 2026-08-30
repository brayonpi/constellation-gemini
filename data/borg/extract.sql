-- Google Borg ClusterData 2019 extraction template.
-- Replace the source table only with the documented public BigQuery table selected for the demo.
-- This query intentionally exports resource classes rather than claiming TPU semantics.
SELECT
  TO_HEX(SHA256(CAST(collection_id AS STRING))) AS anonymized_collection_id,
  priority,
  requested_cpu,
  requested_memory,
  start_time,
  end_time
FROM `google.com:google-cluster-data.clusterdata_2019_a.instance_usage`
WHERE start_time >= @window_start
  AND start_time < @window_end
  AND requested_cpu IS NOT NULL
  AND requested_memory IS NOT NULL
ORDER BY anonymized_collection_id, start_time
LIMIT 1000;
