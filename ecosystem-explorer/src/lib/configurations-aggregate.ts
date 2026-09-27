/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { Configuration, InstrumentationModule } from "@/types/javaagent";
import type { Path } from "@/types/configuration-builder";
import { classifyScope, toValuePath, type DeclarativeScope } from "./declarative-name";

export interface AggregatedConfig {
  entry: Configuration;
  scope: DeclarativeScope;
  path: Path;
}

const SCOPE_ORDER: Record<DeclarativeScope, number> = {
  general: 0,
  common: 1,
  owned: 2,
};

export function aggregateConfigurations(module: InstrumentationModule): AggregatedConfig[] {
  const byDeclarative = new Map<string, Configuration>();
  for (const covered of module.coveredEntries) {
    if (!covered.configurations) continue;
    for (const cfg of covered.configurations) {
      if (!cfg.declarative_name) continue;
      byDeclarative.set(cfg.declarative_name, cfg);
    }
  }

  const aggregated: AggregatedConfig[] = [];
  for (const [declarativeName, entry] of byDeclarative) {
    aggregated.push({
      entry,
      scope: classifyScope(declarativeName),
      path: toValuePath(declarativeName),
    });
  }

  aggregated.sort((a, b) => {
    const byScope = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
    if (byScope !== 0) return byScope;
    return (a.entry.declarative_name ?? "").localeCompare(b.entry.declarative_name ?? "");
  });

  return aggregated;
}

/**
 * Every non-general declarative name (owned and java.common.*) across the
 * given modules. This is the allowlist PRUNE_INSTRUMENTATIONS uses to drop
 * stale `instrumentation/development.java.*` values after an agent-version
 * switch: the schema types `java` as a bare key_value_map, so the per-version
 * inventory is the only source of which names exist.
 *
 * general.* is excluded on purpose. Its validity comes from the (pinned)
 * config schema, and the inventory only mentions a handful of its leaves, so
 * allowlisting it here would delete fields the General card owns.
 *
 * Do not derive this from buildInstrumentationDefaultEntries: that skips
 * options with empty defaults, so a user-set value for such an option would be
 * missing from the allowlist and wrongly pruned.
 */
export function collectVersionedDeclarativeNames(modules: InstrumentationModule[]): string[] {
  const names = new Set<string>();
  for (const mod of modules) {
    for (const cfg of aggregateConfigurations(mod)) {
      if (cfg.scope === "general") continue;
      if (cfg.entry.declarative_name) names.add(cfg.entry.declarative_name);
    }
  }
  return [...names];
}
