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

/**
 * Returns `values` without the `distribution.javaagent.instrumentation.<module>`
 * entries whose module name is absent from `validModules` (the selected agent
 * version's modules, see groupByModule). Branches emptied by the filter are
 * removed. Returns `values` itself when nothing was dropped.
 *
 * Every key under `distribution.javaagent.instrumentation` is treated as a
 * module name, matching how the builder writes module enable/disable flags.
 *
 * This is an output-time filter: builder state keeps the flags so they come
 * back when the user returns to a version that has those modules.
 */
export function filterJavaagentModuleValues(
  values: ConfigValues,
  validModules: ReadonlySet<string>
): ConfigValues {
  const distribution = values.distribution;
  if (!isPlainObject(distribution)) return values;
  const javaagent = distribution.javaagent;
  if (!isPlainObject(javaagent)) return values;
  const instrumentation = javaagent.instrumentation;
  if (!isPlainObject(instrumentation)) return values;

  const nextInst: ConfigValues = {};
  let changed = false;
  for (const [moduleName, moduleVal] of Object.entries(instrumentation)) {
    if (validModules.has(moduleName)) {
      nextInst[moduleName] = moduleVal;
    } else {
      changed = true;
    }
  }
  if (!changed) return values;

  const nextJavaagent: ConfigValues = { ...javaagent };
  if (Object.keys(nextInst).length === 0) {
    delete nextJavaagent.instrumentation;
  } else {
    nextJavaagent.instrumentation = nextInst;
  }
  const nextDistribution: ConfigValues = { ...distribution };
  if (Object.keys(nextJavaagent).length === 0) {
    delete nextDistribution.javaagent;
  } else {
    nextDistribution.javaagent = nextJavaagent;
  }
  const nextValues: ConfigValues = { ...values };
  if (Object.keys(nextDistribution).length === 0) {
    delete nextValues.distribution;
  } else {
    nextValues.distribution = nextDistribution;
  }
  return nextValues;
}
