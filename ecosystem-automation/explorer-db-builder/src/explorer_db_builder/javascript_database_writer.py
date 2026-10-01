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
"""Writes JavaScript instrumentation data to content-addressed file storage.

js-contrib packages version independently, so there is no ecosystem-wide release
to key a version manifest on the way javaagent and collector do. Each package
release gets its own manifest instead:

    javascript/
        index.json                                  # every package at its latest version
        versions/{package}-{version}-index.json     # manifest for one package release
        packages/{package}/{package}-{hash}.json    # full metadata for one package release

Keeping one manifest per release means the shared orphan GC walk works unchanged.
"""

import json
import logging
import re
import shutil
from pathlib import Path
from typing import Any

from semantic_version import Version

from explorer_db_builder import orphan_gc
from explorer_db_builder.content_hashing import content_hash

logger = logging.getLogger(__name__)


class JavascriptDatabaseWriter:
    """Manages writing JS instrumentation packages to a content-addressed file system database."""

    def __init__(self, database_dir: str = "ecosystem-explorer/public/data/javascript") -> None:
        self.database_dir = Path(database_dir)
        self.files_written = 0
        self.total_bytes = 0

    def _sanitize_name(self, name: str) -> str:
        """Sanitizes a name for use as a filename to prevent path traversal."""
        return re.sub(r"[^a-zA-Z0-9._\-]", "_", name)

    def _write_json(self, path: Path, data: Any) -> None:
        content = json.dumps(data, indent=2, sort_keys=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        self.files_written += 1
        self.total_bytes += len(content.encode("utf-8"))

    def _package_file(self, package_name: str, package_hash: str) -> Path:
        """Content-addressed path for one package release (does not create its directory)."""
        safe_name = self._sanitize_name(package_name)
        return self.database_dir / "packages" / safe_name / f"{safe_name}-{package_hash}.json"

    def _markdown_file(self, package_name: str, markdown_hash: str) -> Path:
        """Content-addressed path for a package README (does not create its directory).

        Nothing publishes JS READMEs yet. The path is defined so orphan GC already
        knows where they will live.
        """
        safe_name = self._sanitize_name(package_name)
        return self.database_dir / "markdown" / f"{safe_name}-{markdown_hash}.md"

    def write_package(self, package: dict[str, Any]) -> str:
        """Write one package release to its content-addressed file.

        Args:
            package: Registry metadata for one package release. Must have a "name".

        Returns:
            The 12-char content hash.

        Raises:
            ValueError: If the package has no name.
            OSError: If file writing fails.
        """
        package_name = package.get("name")
        if not package_name:
            raise ValueError("Package is missing a 'name' field")

        package_hash = content_hash(package)
        file_path = self._package_file(package_name, package_hash)

        if file_path.exists():
            logger.debug("Package '%s' hash %s already exists, skipping", package_name, package_hash)
            return package_hash

        file_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_json(file_path, package)
        logger.debug("Wrote package '%s' hash %s", package_name, package_hash)
        return package_hash

    def write_package_version_index(self, package_name: str, version: Version, package_hash: str) -> None:
        """Write the manifest for one package release.

        The "packages" map has a single entry. It uses the same shape as the other
        ecosystems' manifests so orphan GC can read it without special casing.

        Raises:
            OSError: If file writing fails.
        """
        versions_dir = self.database_dir / "versions"
        versions_dir.mkdir(parents=True, exist_ok=True)

        safe_name = self._sanitize_name(package_name)
        version_file = versions_dir / f"{safe_name}-{version}-index.json"
        data = {
            "package": package_name,
            "version": str(version),
            "packages": {package_name: package_hash},
        }
        self._write_json(version_file, data)

    def write_index(self, packages: list[dict[str, Any]]) -> None:
        """Write index.json, the list of every package at its latest version.

        Args:
            packages: Slim index entries, already sorted.

        Raises:
            OSError: If file writing fails.
        """
        self.database_dir.mkdir(parents=True, exist_ok=True)
        index_file = self.database_dir / "index.json"
        self._write_json(index_file, {"ecosystem": "javascript", "packages": packages})
        logger.info("Wrote javascript index with %d packages", len(packages))

    def get_stats(self) -> dict[str, Any]:
        return {"files_written": self.files_written, "total_bytes": self.total_bytes}

    def remove_orphans(self) -> int:
        """Delete content-addressed files no longer referenced by any manifest.

        See :func:`explorer_db_builder.orphan_gc.remove_orphans`.
        """
        return orphan_gc.remove_orphans(
            self.database_dir,
            content_dir="packages",
            index_sections=("packages",),
            content_file=self._package_file,
            markdown_file=self._markdown_file,
        )

    def clean(self) -> None:
        """Remove the javascript database directory and recreate it empty.

        The directory is builder-owned: everything under it goes, including files this
        tool did not write. Curated content the frontend fetches must live outside it
        (see the "Methodology" section of the explorer-db-builder README).
        """
        if self.database_dir.exists():
            logger.info("Cleaning javascript database directory: %s", self.database_dir)
            shutil.rmtree(self.database_dir)
        self.database_dir.mkdir(parents=True, exist_ok=True)
