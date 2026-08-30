locals {
  services = toset([
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "cloudtasks.googleapis.com",
  ])
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each           = local.services
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "web" {
  account_id   = "constellation-web"
  display_name = "Constellation public web service"
}

resource "google_service_account" "worker" {
  account_id   = "constellation-worker"
  display_name = "Constellation private mission worker"
}

resource "google_service_account" "event_push" {
  account_id   = "constellation-events"
  display_name = "Constellation Pub/Sub push identity"
}

resource "google_service_account" "task_invoker" {
  account_id   = "constellation-tasks"
  display_name = "Constellation Cloud Tasks identity"
}

resource "google_service_account_iam_member" "web_can_use_task_identity" {
  service_account_id = google_service_account.task_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.web.email}"
}

resource "google_service_account_iam_member" "worker_can_use_task_identity" {
  service_account_id = google_service_account.task_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_service_account_iam_member" "pubsub_can_mint_event_identity" {
  service_account_id = google_service_account.event_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member = (
    "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  )
}

resource "google_firestore_database" "missions" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.required]
}

resource "google_storage_bucket" "evidence" {
  name                        = "${var.project_id}-constellation-evidence"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_secret_manager_secret" "hexstellar_api_key" {
  secret_id = "constellation-hexstellar-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "worker_secret" {
  secret_id = google_secret_manager_secret.hexstellar_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "web_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.web.email}"
}

resource "google_project_iam_member" "web_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.web.email}"
}

resource "google_project_iam_member" "worker_tasks" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "web_tasks" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.web.email}"
}

resource "google_storage_bucket_iam_member" "worker_evidence" {
  bucket = google_storage_bucket.evidence.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_tasks_queue" "plans" {
  name     = "mission-plans"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 4
    max_dispatches_per_second = 2
  }
  retry_config {
    max_attempts       = 3
    max_retry_duration = "600s"
    min_backoff        = "2s"
    max_backoff        = "30s"
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "constellation-worker"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account = google_service_account.worker.email
    timeout         = "900s"
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }
    containers {
      image = var.image
      resources {
        limits = { cpu = "2", memory = "2Gi" }
      }
      env {
        name  = "CONSTELLATION_MODE"
        value = "cloud"
      }
      env {
        name  = "CONSTELLATION_ROLE"
        value = "worker"
      }
      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "TRUE"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.gemini_location
      }
      env {
        name  = "GEMINI_MODEL"
        value = "gemini-3.5-flash"
      }
      env {
        name  = "HEXTELLAR_API_URL"
        value = var.hexstellar_api_url
      }
      env {
        name  = "CONSTELLATION_TASK_SERVICE_ACCOUNT"
        value = google_service_account.task_invoker.email
      }
      env {
        name  = "CONSTELLATION_TASK_LOCATION"
        value = var.region
      }
      env {
        name = "HEXTELLAR_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.hexstellar_api_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "web" {
  name                = "constellation-web"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account = google_service_account.web.email
    timeout         = "60s"
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
    containers {
      image = var.image
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "CONSTELLATION_MODE"
        value = "cloud"
      }
      env {
        name  = "CONSTELLATION_ROLE"
        value = "web"
      }
      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "TRUE"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.gemini_location
      }
      env {
        name  = "GEMINI_MODEL"
        value = "gemini-3.5-flash"
      }
      env {
        name  = "CONSTELLATION_TASK_SERVICE_ACCOUNT"
        value = google_service_account.task_invoker.email
      }
      env {
        name  = "CONSTELLATION_TASK_LOCATION"
        value = var.region
      }
      env {
        name  = "CONSTELLATION_WORKER_BASE_URL"
        value = google_cloud_run_v2_service.worker.uri
      }
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "public_web" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "event_worker" {
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.event_push.email}"
}

resource "google_cloud_run_v2_service_iam_member" "task_worker" {
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.task_invoker.email}"
}

resource "google_pubsub_topic" "telemetry" {
  name       = "constellation-telemetry"
  depends_on = [google_project_service.required]
}

resource "google_pubsub_subscription" "worker_push" {
  name  = "constellation-telemetry-worker"
  topic = google_pubsub_topic.telemetry.id
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker.uri}/internal/pubsub"
    oidc_token {
      service_account_email = google_service_account.event_push.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  ack_deadline_seconds       = 60
  message_retention_duration = "86400s"
  retry_policy {
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }
}
