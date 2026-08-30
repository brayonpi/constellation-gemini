output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "worker_url" {
  value     = google_cloud_run_v2_service.worker.uri
  sensitive = true
}

output "telemetry_topic" {
  value = google_pubsub_topic.telemetry.name
}

output "evidence_bucket" {
  value = google_storage_bucket.evidence.name
}
