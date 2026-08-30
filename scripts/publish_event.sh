#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 GOOGLE_CLOUD_PROJECT MISSION_ID" >&2
  exit 2
fi

project_id="$1"
mission_id="$2"
payload="{\"mission_id\":\"${mission_id}\",\"telemetry\":{\"event_id\":\"cloud-demo-${mission_id}\",\"event_type\":\"compound_orbital_compute_failure\",\"affected_resources\":[\"GS-PACIFIC-02\",\"COMPUTE-SAT-07\",\"COMPUTE-SAT-08\"],\"start_minute\":5,\"expected_duration_minutes\":42,\"confidence\":1.0,\"source\":\"gcloud-pubsub-demo\"}}"

gcloud pubsub topics publish constellation-telemetry --project "$project_id" --message "$payload"
