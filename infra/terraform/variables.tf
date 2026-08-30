variable "project_id" {
  description = "Google Cloud project hosting the hackathon deployment."
  type        = string
}

variable "region" {
  description = "Regional infrastructure location. Confirm Gemini model availability separately."
  type        = string
  default     = "us-central1"
}

variable "gemini_location" {
  description = "Vertex AI location for Gemini 3.5 Flash."
  type        = string
  default     = "global"
}

variable "image" {
  description = "Immutable container image URI, preferably addressed by digest."
  type        = string
}

variable "hexstellar_api_url" {
  description = "Public HexStellar API base URL."
  type        = string
  sensitive   = false
}
