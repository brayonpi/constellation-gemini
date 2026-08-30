# Google Cloud deployment

1. Create or select a billing-enabled project.
2. Build and push the container to Artifact Registry using an immutable digest.
3. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill the project and digest.
4. Run `terraform init`, `terraform plan`, and `terraform apply`.
5. Add the HexStellar key as a new version of `constellation-hexstellar-api-key`.
6. Re-deploy the worker so the `latest` secret version is available.
7. Create a mission in the web UI and publish a telemetry event with `scripts/publish_event.sh`.
8. Capture the Pub/Sub delivery, private worker logs, Vertex model record, Firestore update, and public Cloud Run URL for the demo evidence.

The Terraform configuration deliberately enables deletion protection on both Cloud Run services.
The worker has no `allUsers` invoker binding.
The public web identity cannot access the HexStellar secret.
