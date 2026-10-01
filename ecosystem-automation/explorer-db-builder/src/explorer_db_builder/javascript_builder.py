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
"""Orchestrates the JavaScript instrumentation database build pipeline."""

import logging
from typing import Any, Optional

from js_instrumentation_watcher.inventory_manager import InventoryManager
from semantic_version import Version

from explorer_db_builder.javascript_database_writer import JavascriptDatabaseWriter

logger = logging.getLogger(__name__)

REGISTRY_DIR = "ecosystem-registry/javascript"


def make_index_package(package: dict[str, Any], versions: list[Version]) -> dict[str, Any]:
    """Build the slim index.json entry for a package from its latest release.

    Args:
        package: Registry metadata for the package's latest release.
        versions: Every version of the package, newest first.

    Returns:
        The fields the list page needs, plus the version list so a version picker
        doesn't have to fetch every manifest to know what exists.
    """
    return {
        "name": package["name"],
        "npm_package": package.get("npm_package"),
        "description": package.get("description"),
        "version": str(versions[0]),
        "versions": [str(v) for v in versions],
        "in_auto_instrumentations_node": bool(package.get("in_auto_instrumentations_node")),
    }


def run_javascript_builder(
    inventory_manager: Optional[InventoryManager] = None,
    db_writer: Optional[JavascriptDatabaseWriter] = None,
    clean: bool = False,
) -> int:
    """Run the JavaScript instrumentation database build.

    Every stored release of every package is published, not just the latest, so
    the detail page can offer a version picker later without a schema change.

    Args:
        inventory_manager: Optional inventory manager (for testing).
        db_writer: Optional database writer (for testing).
        clean: If True, wipe the output directory before building.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    try:
        inventory_manager = inventory_manager or InventoryManager(registry_dir=REGISTRY_DIR)
        db_writer = db_writer or JavascriptDatabaseWriter()

        if clean:
            db_writer.clean()

        packages = inventory_manager.list_packages()
        if not packages:
            raise ValueError("No packages found in the javascript registry")

        logger.info(f"Processing {len(packages)} javascript packages")

        index_entries: list[dict[str, Any]] = []
        release_count = 0
        for package_name in packages:
            # Sorted as semver: sorted as text, 0.9.0 would land above 0.10.0.
            versions = sorted((Version(v) for v in inventory_manager.list_versions(package_name)), reverse=True)

            latest: dict[str, Any] = {}
            for version in versions:
                package = inventory_manager.load(package_name, str(version))
                if package.get("name") != package_name:
                    raise ValueError(f"Registry file for {package_name} v{version} has name {package.get('name')!r}")

                package_hash = db_writer.write_package(package)
                db_writer.write_package_version_index(package_name, version, package_hash)
                release_count += 1
                if not latest:
                    latest = package

            index_entries.append(make_index_package(latest, versions))

        db_writer.write_index(index_entries)

        # Manifests (the reachability source) are all on disk now. Skipped after
        # --clean, which already wiped everything.
        if not clean:
            db_writer.remove_orphans()

        stats = db_writer.get_stats()
        total_mb = stats["total_bytes"] / (1024 * 1024)
        logger.info("")
        logger.info("JavaScript Database Statistics:")
        logger.info(f"  Packages: {len(index_entries)} ({release_count} releases)")
        logger.info(f"  Files written: {stats['files_written']}")
        logger.info(f"  Total size: {stats['total_bytes']:,} bytes ({total_mb:.2f} MB)")
        return 0

    except ValueError as e:
        logger.error(f"❌ Validation error: {e}")
        return 1
    except OSError as e:
        logger.error(f"❌ File system error: {e}")
        return 1
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}", exc_info=True)
        return 1
