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

"""Inventory manager for JS instrumentation registry storage."""

import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

VERSION_FILE_GLOB = "v*.yaml"


class InventoryManager:
    """
    Manages storage of JS instrumentation metadata in the registry.

    Registry layout:
        ecosystem-registry/javascript/{package-name}/v{version}.yaml
    """

    def __init__(self, registry_dir: str):
        """
        Args:
            registry_dir: Base registry directory, e.g. 'ecosystem-registry/javascript'
        """
        self.registry_dir = Path(registry_dir)

    def version_exists(self, package_name: str, version: str) -> bool:
        """
        Check if a specific package version already exists in the registry.

        Args:
            package_name: Package directory name, e.g. 'instrumentation-express'
            version: Version string, e.g. '0.66.0'

        Returns:
            True if the version file exists
        """
        return self._version_path(package_name, version).exists()

    def save(self, package_name: str, version: str, data: dict) -> None:
        """
        Save a package version to the registry.

        Args:
            package_name: Package directory name
            version: Version string
            data: Metadata dict to serialize as YAML
        """
        path = self._version_path(package_name, version)
        path.parent.mkdir(parents=True, exist_ok=True)

        with path.open("w") as f:
            yaml.dump(
                data,
                f,
                default_flow_style=False,
                sort_keys=True,
                allow_unicode=True,
            )

        logger.debug("Saved %s v%s to %s", package_name, version, path)

    def list_packages(self) -> list[str]:
        """
        List every package that has at least one version in the registry.

        Returns:
            Package directory names, sorted alphabetically. Empty if the
            registry directory doesn't exist yet.
        """
        if not self.registry_dir.is_dir():
            return []

        return sorted(
            item.name for item in self.registry_dir.iterdir() if item.is_dir() and any(item.glob(VERSION_FILE_GLOB))
        )

    def list_versions(self, package_name: str) -> list[str]:
        """
        List the version strings stored for a package.

        Args:
            package_name: Package directory name, e.g. 'instrumentation-express'

        Returns:
            Version strings without the leading 'v', in no particular order.
            Callers that need ordering should sort them as semver, not as text.
        """
        package_dir = self.registry_dir / package_name
        return [path.stem.removeprefix("v") for path in package_dir.glob(VERSION_FILE_GLOB)]

    def load(self, package_name: str, version: str) -> dict:
        """
        Load one package version from the registry.

        Args:
            package_name: Package directory name
            version: Version string, e.g. '0.66.0'

        Returns:
            The metadata dict that was saved for that version

        Raises:
            FileNotFoundError: If that version isn't in the registry
            ValueError: If the file doesn't contain a YAML mapping
        """
        path = self._version_path(package_name, version)
        with path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if not isinstance(data, dict):
            raise ValueError(f"Registry file {path} does not contain a mapping")

        return data

    def _version_path(self, package_name: str, version: str) -> Path:
        """
        Build the path for a package version file.

        Args:
            package_name: Package directory name
            version: Version string

        Returns:
            Path to the version YAML file
        """
        return self.registry_dir / package_name / f"v{version}.yaml"
