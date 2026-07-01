"""Shared fixtures for MISP Event Template Editor tests."""

import os
import sys

import pytest

# Ensure the tool root is importable (mirrors the sibling tools' conftest).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def client():
    """Flask test client."""
    from app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
