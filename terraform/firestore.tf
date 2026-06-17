# Firestore (Native) is the control plane (SPEC §2). Location is PERMANENT.
resource "google_firestore_database" "control_plane" {
  project     = var.project_id
  name        = "(default)"
  location_id = local.firestore_location
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.enabled]
}
