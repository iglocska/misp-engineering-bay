"""Shared fixtures for MISP Event Template Editor tests."""

import os
import sys

import pytest

# Ensure the tool root is importable (mirrors the sibling tools' conftest).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_output(tmp_path, monkeypatch):
    """Redirect user-draft output to a temp dir for every test."""
    out = str(tmp_path / "output")
    os.makedirs(out, exist_ok=True)
    monkeypatch.setattr(config, "OUTPUT_PATH", out)
    yield out


@pytest.fixture
def client():
    """Flask test client."""
    from app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
