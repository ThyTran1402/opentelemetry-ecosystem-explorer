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
 * Every owned-scope declarative option path across the given modules, as
 * dot-joined value paths (`AggregatedConfig.path.join(".")`, e.g.
 * `"instrumentation/development.graphql.depth"`). Used to allowlist the
 * `instrumentation/development` subtree when pruning stale option values on
 * an agent-version switch (see PRUNE_INSTRUMENTATIONS in
 * configuration-builder-reducer.ts). `general.*`/`java.common.*` paths are
 * intentionally excluded — they're version-shared, and the reducer protects
 * them structurally regardless of this allowlist.
 *
 * Deliberately does NOT reuse `buildInstrumentationDefaultEntries`: that
 * function drops options whose *default* value is empty, since an empty
 * default wouldn't appear in a bulk-add. Here we need every currently-valid
 * owned option name regardless of its default, or a option the user set to a
 * non-empty value (whose default happens to be empty) would be missing from
 * the allowlist and incorrectly pruned.
 */
export function collectOwnedConfigPathKeys(modules: InstrumentationModule[]): string[] {
  const keys = new Set<string>();
  for (const mod of modules) {
    for (const cfg of aggregateConfigurations(mod)) {
      if (cfg.scope !== "owned") continue;
      keys.add(cfg.path.join("."));
    }
  }
  return [...keys];
}
