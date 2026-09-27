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
import type { ConfigValues } from "@/types/configuration-builder";
import { isPlainObject } from "@/lib/value-guards";
import { INSTRUMENTATION_DEV_KEY } from "@/lib/declarative-name";

// Only the `java` branch of instrumentation/development is filtered against
// the per-version inventory. `general` is schema-typed (pinned by
// MAX_SUPPORTED_CONFIG_SCHEMA_VERSION) and other language keys are not
// described by the Java agent inventory at all, so both are left untouched.
const JAVA_DEV_KEY = "java";

/**
 * Drops leaves under `node` whose declarative name is not in `valid`. `prefix`
 * is the dotted declarative name of `node` (e.g. "java" or "java.common"), so
 * a leaf's key maps 1:1 onto a declarative name. Returns `node` itself when
 * nothing was dropped.
 */
function filterNode(node: ConfigValues, valid: ReadonlySet<string>, prefix: string): ConfigValues {
  let changed = false;
  const next: ConfigValues = {};
  for (const [key, val] of Object.entries(node)) {
    const name = `${prefix}.${key}`;
    // Check for an exact match before recursing: a valid map-typed option is
    // a plain object whose keys are user data, not declarative-name segments,
    // so descending into it would drop the user's map entries.
    if (valid.has(name)) {
      next[key] = val;
      continue;
    }
    if (isPlainObject(val)) {
      // Either an intermediate namespace for a still-valid deeper option, or
      // an orphaned branch that recursion empties out entirely.
      const filtered = filterNode(val, valid, name);
      if (Object.keys(filtered).length === 0) {
        changed = true;
      } else {
        next[key] = filtered;
        if (filtered !== val) changed = true;
      }
      continue;
    }
    changed = true;
  }
  return changed ? next : node;
}

/**
 * Returns `values` without the `instrumentation/development.java.*` entries
 * whose declarative name is absent from `validNames` (the selected agent
 * version's inventory, see collectVersionedDeclarativeNames). Branches emptied
 * by the filter are removed. Returns `values` itself when nothing was dropped.
 *
 * This is an output-time filter: builder state keeps the values so they come
 * back when the user returns to a version that has them.
 */
export function filterJavaDevValues(
  values: ConfigValues,
  validNames: ReadonlySet<string>
): ConfigValues {
  const dev = values[INSTRUMENTATION_DEV_KEY];
  if (!isPlainObject(dev)) return values;
  const java = dev[JAVA_DEV_KEY];
  if (!isPlainObject(java)) return values;

  const filtered = filterNode(java, validNames, JAVA_DEV_KEY);
  if (filtered === java) return values;

  const nextDev: ConfigValues = { ...dev };
  if (Object.keys(filtered).length === 0) {
    delete nextDev[JAVA_DEV_KEY];
  } else {
    nextDev[JAVA_DEV_KEY] = filtered;
  }
  const nextValues: ConfigValues = { ...values };
  if (Object.keys(nextDev).length === 0) {
    delete nextValues[INSTRUMENTATION_DEV_KEY];
  } else {
    nextValues[INSTRUMENTATION_DEV_KEY] = nextDev;
  }
  return nextValues;
}
