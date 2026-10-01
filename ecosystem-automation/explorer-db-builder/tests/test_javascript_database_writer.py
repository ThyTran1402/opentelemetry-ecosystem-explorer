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
"""Tests for JavascriptDatabaseWriter."""

import json

import pytest
from explorer_db_builder.javascript_database_writer import JavascriptDatabaseWriter
from semantic_version import Version


def _package(version: str = "0.70.0", **extra) -> dict:
    return {"name": "instrumentation-express", "version": version, **extra}


def test_write_package_is_content_addressed(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))

    package_hash = writer.write_package(_package())

    path = tmp_path / "packages" / "instrumentation-express" / f"instrumentation-express-{package_hash}.json"
    assert json.loads(path.read_text()) == _package()


def test_write_package_skips_existing_file(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))

    first = writer.write_package(_package())
    second = writer.write_package(_package())

    assert first == second
    assert writer.get_stats()["files_written"] == 1


def test_write_package_different_content_gets_different_file(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))

    old = writer.write_package(_package("0.69.0"))
    new = writer.write_package(_package("0.70.0"))

    assert old != new
    assert len(list((tmp_path / "packages" / "instrumentation-express").glob("*.json"))) == 2


def test_write_package_requires_name(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))

    with pytest.raises(ValueError, match="missing a 'name'"):
        writer.write_package({"version": "0.70.0"})


def test_package_name_is_sanitized_in_paths(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))

    package_hash = writer.write_package({"name": "../escape", "version": "1.0.0"})

    assert (tmp_path / "packages" / ".._escape" / f".._escape-{package_hash}.json").exists()
    assert not (tmp_path.parent / "escape").exists()


def test_write_package_version_index(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))

    writer.write_package_version_index("instrumentation-express", Version("0.70.0"), "abc123def456")

    data = json.loads((tmp_path / "versions" / "instrumentation-express-0.70.0-index.json").read_text())
    assert data == {
        "package": "instrumentation-express",
        "version": "0.70.0",
        "packages": {"instrumentation-express": "abc123def456"},
    }


def test_write_index(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path / "javascript"))
    entries = [{"name": "instrumentation-express", "version": "0.70.0"}]

    writer.write_index(entries)

    data = json.loads((tmp_path / "javascript" / "index.json").read_text())
    assert data == {"ecosystem": "javascript", "packages": entries}


def test_remove_orphans_keeps_referenced_and_removes_unreferenced(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))
    live = writer.write_package(_package("0.70.0"))
    writer.write_package_version_index("instrumentation-express", Version("0.70.0"), live)
    # Written but never referenced by a manifest, e.g. left behind after the
    # builder's output shape changed.
    stale = writer.write_package(_package("0.70.0", description="old shape"))

    removed = writer.remove_orphans()

    package_dir = tmp_path / "packages" / "instrumentation-express"
    assert removed == 1
    assert (package_dir / f"instrumentation-express-{live}.json").exists()
    assert not (package_dir / f"instrumentation-express-{stale}.json").exists()


def test_remove_orphans_keeps_referenced_markdown(tmp_path):
    writer = JavascriptDatabaseWriter(str(tmp_path))
    package_hash = writer.write_package(_package(markdown_hash="aaaaaaaaaaaa"))
    writer.write_package_version_index("instrumentation-express", Version("0.70.0"), package_hash)
    markdown_dir = tmp_path / "markdown"
    markdown_dir.mkdir()
    (markdown_dir / "instrumentation-express-aaaaaaaaaaaa.md").write_text("# live")
    (markdown_dir / "instrumentation-express-bbbbbbbbbbbb.md").write_text("# stale")

    writer.remove_orphans()

    assert (markdown_dir / "instrumentation-express-aaaaaaaaaaaa.md").exists()
    assert not (markdown_dir / "instrumentation-express-bbbbbbbbbbbb.md").exists()


def test_clean_removes_everything(tmp_path):
    database_dir = tmp_path / "javascript"
    writer = JavascriptDatabaseWriter(str(database_dir))
    writer.write_package(_package())
    (database_dir / "hand-written.json").write_text("{}")

    writer.clean()

    assert database_dir.is_dir()
    assert list(database_dir.iterdir()) == []
