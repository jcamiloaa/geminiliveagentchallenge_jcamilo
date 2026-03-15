"""
Cloud Logging integration for AeroBrowser Navigator.

Uses Google Cloud Logging when running on GCP (Cloud Run),
falls back to standard Python logging locally.
"""
import logging
import os

logger = logging.getLogger("aerobrowser")


def setup():
    """Initialize logging — Cloud Logging on GCP, standard logging locally."""
    if os.environ.get("K_SERVICE"):
        # Running on Cloud Run — use Google Cloud Logging
        try:
            import google.cloud.logging
            client = google.cloud.logging.Client()
            client.setup_logging()
            logger.info("Cloud Logging initialized (Cloud Run)")
            return
        except Exception as e:
            print(f"Cloud Logging setup failed, falling back to stdout: {e}")

    # Local development — structured stdout logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
    )
    logger.info("Local logging initialized")
