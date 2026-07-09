"""Validation helpers for MISP Guard configuration rules."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse


@dataclass
class ValidationResult:
    errors: list[dict[str, str]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors

    def add_error(self, path: str, message: str) -> None:
        self.errors.append({"path": path, "message": message})

    def add_warning(self, path: str, message: str) -> None:
        self.warnings.append({"path": path, "message": message})

    def to_dict(self) -> dict[str, Any]:
        return {"valid": self.valid, "errors": self.errors, "warnings": self.warnings}


def _is_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def validate_config(data: Any) -> ValidationResult:
    result = ValidationResult()
    if not isinstance(data, dict):
        result.add_error("$", "Configuration must be a JSON object")
        return result

    allowlist = data.get("allowlist")
    if not isinstance(allowlist, dict):
        result.add_error("allowlist", "allowlist must be an object")
    else:
        for key in ("urls", "domains"):
            if not _is_list(allowlist.get(key)):
                result.add_error(f"allowlist.{key}", f"allowlist.{key} must be a list of strings")
        for idx, url in enumerate(allowlist.get("urls", []) if isinstance(allowlist.get("urls"), list) else []):
            parsed = urlparse(url)
            if url and parsed.scheme not in ("http", "https"):
                result.add_warning(f"allowlist.urls[{idx}]", "URL should include an http or https scheme")

    compartments = data.get("compartments_rules", {}).get("can_reach") if isinstance(data.get("compartments_rules"), dict) else None
    if not isinstance(compartments, dict) or not compartments:
        result.add_error("compartments_rules.can_reach", "At least one compartment reachability rule is required")
        compartment_ids: set[str] = set()
    else:
        compartment_ids = set(compartments.keys())
        for compartment_id, reachable in compartments.items():
            if not isinstance(compartment_id, str) or not compartment_id:
                result.add_error("compartments_rules.can_reach", "Compartment IDs must be non-empty strings")
            if not _is_list(reachable):
                result.add_error(f"compartments_rules.can_reach.{compartment_id}", "Reachable compartments must be a list of strings")
                continue
            unknown = sorted(set(reachable) - compartment_ids)
            if unknown:
                result.add_warning(f"compartments_rules.can_reach.{compartment_id}", f"References undefined compartments: {', '.join(unknown)}")

    instances = data.get("instances")
    if not isinstance(instances, dict) or not instances:
        result.add_error("instances", "At least one MISP instance is required")
        return result

    for instance_id, instance in instances.items():
        base = f"instances.{instance_id}"
        if not isinstance(instance_id, str) or not instance_id:
            result.add_error("instances", "Instance IDs must be non-empty strings")
        if not isinstance(instance, dict):
            result.add_error(base, "Instance must be an object")
            continue
        if not instance.get("host"):
            result.add_error(f"{base}.host", "Host is required")
        ip = instance.get("ip", "")
        if ip:
            try:
                ipaddress.ip_address(ip)
            except ValueError:
                result.add_error(f"{base}.ip", "IP address is not valid")
        port = instance.get("port")
        if not isinstance(port, int) or not (1 <= port <= 65535):
            result.add_error(f"{base}.port", "Port must be an integer between 1 and 65535")
        compartment_id = instance.get("compartment_id")
        if not isinstance(compartment_id, str) or not compartment_id:
            result.add_error(f"{base}.compartment_id", "Compartment ID is required")
        elif compartment_ids and compartment_id not in compartment_ids:
            result.add_error(f"{base}.compartment_id", "Compartment ID must exist in compartments_rules.can_reach")
        taxonomies = instance.get("taxonomies_rules")
        if not isinstance(taxonomies, dict):
            result.add_error(f"{base}.taxonomies_rules", "taxonomies_rules must be an object")
        else:
            if not _is_list(taxonomies.get("required_taxonomies")):
                result.add_error(f"{base}.taxonomies_rules.required_taxonomies", "required_taxonomies must be a list of strings")
            if not isinstance(taxonomies.get("allowed_tags"), dict):
                result.add_error(f"{base}.taxonomies_rules.allowed_tags", "allowed_tags must be an object keyed by taxonomy")
            else:
                for taxonomy, tags in taxonomies["allowed_tags"].items():
                    if not isinstance(taxonomy, str) or not _is_list(tags):
                        result.add_error(f"{base}.taxonomies_rules.allowed_tags.{taxonomy}", "Each allowed tag entry must be a list of strings")
            if not _is_list(taxonomies.get("blocked_tags")):
                result.add_error(f"{base}.taxonomies_rules.blocked_tags", "blocked_tags must be a list of strings")
        for key in ("blocked_distribution_levels", "blocked_sharing_groups_uuids", "blocked_attribute_types", "blocked_attribute_categories", "blocked_object_types"):
            if not _is_list(instance.get(key)):
                result.add_error(f"{base}.{key}", f"{key} must be a list of strings")
    return result
