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

"""Tests for InventoryManager."""

import pytest
import yaml
from js_instrumentation_watcher.inventory_manager import InventoryManager


def test_save_and_version_exists(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    data = {"name": "instrumentation-express", "version": "0.66.0"}

    assert not manager.version_exists("instrumentation-express", "0.66.0")

    manager.save("instrumentation-express", "0.66.0", data)

    assert manager.version_exists("instrumentation-express", "0.66.0")


def test_save_writes_valid_yaml(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    data = {
        "name": "instrumentation-express",
        "version": "0.66.0",
        "npm_package": "@opentelemetry/instrumentation-express",
    }

    manager.save("instrumentation-express", "0.66.0", data)

    path = tmp_path / "instrumentation-express" / "v0.66.0.yaml"
    assert path.exists()

    loaded = yaml.safe_load(path.read_text())
    assert loaded["name"] == "instrumentation-express"
    assert loaded["npm_package"] == "@opentelemetry/instrumentation-express"


def test_version_path_format(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    manager.save("instrumentation-mongoose", "0.64.0", {"name": "test"})

    expected = tmp_path / "instrumentation-mongoose" / "v0.64.0.yaml"
    assert expected.exists()


def test_list_packages_sorted_and_only_with_versions(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    manager.save("instrumentation-pg", "0.60.0", {"name": "instrumentation-pg"})
    manager.save("instrumentation-express", "0.66.0", {"name": "instrumentation-express"})
    # A directory with no version files and a stray file at the top level
    # are not packages.
    (tmp_path / "instrumentation-empty").mkdir()
    (tmp_path / "README.md").write_text("notes")

    assert manager.list_packages() == ["instrumentation-express", "instrumentation-pg"]


def test_list_packages_empty_when_registry_missing(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path / "does-not-exist"))

    assert manager.list_packages() == []


def test_list_versions_strips_prefix_and_ignores_other_files(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    manager.save("instrumentation-express", "0.9.0", {"name": "instrumentation-express"})
    manager.save("instrumentation-express", "0.10.0", {"name": "instrumentation-express"})
    (tmp_path / "instrumentation-express" / "notes.txt").write_text("not a version")

    assert sorted(manager.list_versions("instrumentation-express")) == ["0.10.0", "0.9.0"]


def test_load_round_trips_saved_data(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    data = {
        "name": "instrumentation-express",
        "version": "0.66.0",
        "tested_versions": [{"package": "express", "range": ">=4.16.2 <6", "source": ".tav.yml"}],
    }
    manager.save("instrumentation-express", "0.66.0", data)

    assert manager.load("instrumentation-express", "0.66.0") == data


def test_load_rejects_non_mapping_file(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))
    path = tmp_path / "instrumentation-express" / "v0.66.0.yaml"
    path.parent.mkdir()
    path.write_text("- just\n- a list\n")

    with pytest.raises(ValueError, match="does not contain a mapping"):
        manager.load("instrumentation-express", "0.66.0")


def test_load_missing_version_raises(tmp_path):
    manager = InventoryManager(registry_dir=str(tmp_path))

    with pytest.raises(FileNotFoundError):
        manager.load("instrumentation-express", "0.66.0")
