"""Standalone ops scripts for icaro_api.

These are not imported by the application itself — they are run directly
(``uv run python -m icaro_api.scripts.<name>``) against a live Firestore
project for one-off maintenance tasks (migrations, backfills).
"""
