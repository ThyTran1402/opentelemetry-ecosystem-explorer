# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Tests for javascript_builder module."""

import json
from unittest.mock import MagicMock

import pytest
from explorer_db_builder.javascript_builder import run_javascript_builder
from explorer_db_builder.javascript_database_writer import JavascriptDatabaseWriter
from js_instrumentation_watcher.inventory_manager import InventoryManager


def _release(name: str, version: str, **extra) -> dict:
    return {
        "name": name,
        "npm_package": f"@opentelemetry/{name}",
        "version": version,
        "description": f"Instrumentation for {name}",
        "in_auto_instrumentations_node": True,
        **extra,
    }


@pytest.fixture
def registry(tmp_path):
    """A small registry written through the watcher's own InventoryManager."""
    manager = InventoryManager(registry_dir=str(tmp_path / "registry"))
    for version in ("0.9.0", "0.10.0"):
        manager.save("instrumentation-express", version, _release("instrumentation-express", version))
    manager.save(
        "instrumentation-oracledb",
        "0.47.0",
        _release("instrumentation-oracledb", "0.47.0", in_auto_instrumentations_node=False),
    )
    return manager


@pytest.fixture
def writer(tmp_path):
    return JavascriptDatabaseWriter(str(tmp_path / "javascript"))


def _read(path):
    return json.loads(path.read_text())


def test_success_writes_index_manifests_and_packages(registry, writer):
    assert run_javascript_builder(inventory_manager=registry, db_writer=writer) == 0

    db = writer.database_dir
    assert (db / "index.json").exists()
    assert sorted(p.name for p in (db / "versions").iterdir()) == [
        "instrumentation-express-0.10.0-index.json",
        "instrumentation-express-0.9.0-index.json",
        "instrumentation-oracledb-0.47.0-index.json",
    ]
    assert len(list((db / "packages").glob("*/*.json"))) == 3


def test_index_uses_latest_version_by_semver(registry, writer):
    run_javascript_builder(inventory_manager=registry, db_writer=writer)

    index = _read(writer.database_dir / "index.json")
    express = next(p for p in index["packages"] if p["name"] == "instrumentation-express")
    # Sorted as text, 0.9.0 would come before 0.10.0.
    assert express["version"] == "0.10.0"
    assert express["versions"] == ["0.10.0", "0.9.0"]


def test_index_entry_shape(registry, writer):
    run_javascript_builder(inventory_manager=registry, db_writer=writer)

    index = _read(writer.database_dir / "index.json")
    assert index["ecosystem"] == "javascript"
    assert [p["name"] for p in index["packages"]] == ["instrumentation-express", "instrumentation-oracledb"]
    assert index["packages"][1] == {
        "name": "instrumentation-oracledb",
        "npm_package": "@opentelemetry/instrumentation-oracledb",
        "description": "Instrumentation for instrumentation-oracledb",
        "version": "0.47.0",
        "versions": ["0.47.0"],
        "in_auto_instrumentations_node": False,
    }


def test_manifest_points_at_that_release(registry, writer):
    run_javascript_builder(inventory_manager=registry, db_writer=writer)

    db = writer.database_dir
    manifest = _read(db / "versions" / "instrumentation-express-0.9.0-index.json")
    package_hash = manifest["packages"]["instrumentation-express"]
    package = _read(db / "packages" / "instrumentation-express" / f"instrumentation-express-{package_hash}.json")
    assert package == _release("instrumentation-express", "0.9.0")


def test_package_file_matches_registry_exactly(registry, writer):
    tested = [{"package": "oracledb", "range": "6.7.0", "source": ".tav.yml"}]
    registry.save(
        "instrumentation-oracledb",
        "0.48.0",
        _release("instrumentation-oracledb", "0.48.0", tested_versions=tested),
    )

    run_javascript_builder(inventory_manager=registry, db_writer=writer)

    db = writer.database_dir
    manifest = _read(db / "versions" / "instrumentation-oracledb-0.48.0-index.json")
    package_hash = manifest["packages"]["instrumentation-oracledb"]
    package = _read(db / "packages" / "instrumentation-oracledb" / f"instrumentation-oracledb-{package_hash}.json")
    assert package == registry.load("instrumentation-oracledb", "0.48.0")


def test_rebuild_is_byte_identical(registry, writer):
    run_javascript_builder(inventory_manager=registry, db_writer=writer)
    first = {p: p.read_bytes() for p in writer.database_dir.rglob("*.json")}

    run_javascript_builder(inventory_manager=registry, db_writer=writer)
    second = {p: p.read_bytes() for p in writer.database_dir.rglob("*.json")}

    assert first == second


def test_returns_1_when_registry_empty(tmp_path, writer):
    empty = InventoryManager(registry_dir=str(tmp_path / "empty"))

    assert run_javascript_builder(inventory_manager=empty, db_writer=writer) == 1


def test_returns_1_on_name_mismatch(registry, writer):
    registry.save("instrumentation-pg", "0.60.0", _release("instrumentation-mysql", "0.60.0"))

    assert run_javascript_builder(inventory_manager=registry, db_writer=writer) == 1


def test_returns_1_on_unparseable_version(registry, writer):
    registry.save("instrumentation-pg", "latest", _release("instrumentation-pg", "latest"))

    assert run_javascript_builder(inventory_manager=registry, db_writer=writer) == 1


def test_returns_1_on_unhashable_value(registry, writer):
    # An unquoted date in YAML loads as datetime.date, which isn't JSON, so
    # hashing raises TypeError. That must fail the build, not crash it.
    path = registry.registry_dir / "instrumentation-pg" / "v0.60.0.yaml"
    path.parent.mkdir()
    path.write_text("name: instrumentation-pg\nversion: 0.60.0\nreleased: 2026-09-30\n")

    assert run_javascript_builder(inventory_manager=registry, db_writer=writer) == 1


def test_returns_1_on_write_failure(registry):
    failing = MagicMock()
    failing.write_package.side_effect = OSError("disk full")

    assert run_javascript_builder(inventory_manager=registry, db_writer=failing) == 1


def test_removes_orphans_when_incremental(registry, writer):
    run_javascript_builder(inventory_manager=registry, db_writer=writer)
    stale = writer.database_dir / "packages" / "instrumentation-express" / "instrumentation-express-000000000000.json"
    stale.write_text("{}")

    run_javascript_builder(inventory_manager=registry, db_writer=writer)

    assert not stale.exists()


def test_clean_wipes_before_building(registry, writer):
    writer.database_dir.mkdir(parents=True)
    leftover = writer.database_dir / "leftover.json"
    leftover.write_text("{}")

    assert run_javascript_builder(inventory_manager=registry, db_writer=writer, clean=True) == 0

    assert not leftover.exists()
    assert (writer.database_dir / "index.json").exists()


def test_skips_orphan_gc_when_clean(registry):
    mock_writer = MagicMock()
    mock_writer.write_package.return_value = "abc123def456"
    mock_writer.get_stats.return_value = {"files_written": 0, "total_bytes": 0}

    run_javascript_builder(inventory_manager=registry, db_writer=mock_writer, clean=True)

    mock_writer.clean.assert_called_once()
    mock_writer.remove_orphans.assert_not_called()
