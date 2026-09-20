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
import type {
  ConfigurationBuilderState,
  ConfigurationBuilderAction,
  ConfigValues,
  ConfigValue,
} from "@/types/configuration-builder";
import { getByPath, setByPath, serializePath } from "@/lib/config-path";
import { hasUserValues } from "@/lib/state-hydrate";
import { isPlainObject } from "@/lib/value-guards";
import { buildListItemIds, generateListItemId } from "@/lib/build-list-item-ids";

export const INITIAL_STATE: ConfigurationBuilderState = {
  version: "",
  values: {},
  enabledSections: {},
  validationErrors: {},
  isDirty: false,
  listItemIds: {},
};

const INSTRUMENTATION_PATH = ["distribution", "javaagent", "instrumentation"];
const INSTRUMENTATION_DEV_KEY = "instrumentation/development";
const INSTRUMENTATION_DEV_PATH = [INSTRUMENTATION_DEV_KEY];

function cleanInstrumentation(values: ConfigValues): ConfigValues {
  if (!values.distribution || typeof values.distribution !== "object") return values;
  const dist = { ...values.distribution } as ConfigValues;
  if (!dist.javaagent || typeof dist.javaagent !== "object") return values;
  const ja = { ...dist.javaagent } as ConfigValues;
  if (!ja.instrumentation || typeof ja.instrumentation !== "object") return values;

  const inst = { ...ja.instrumentation } as ConfigValues;
  let changed = false;

  for (const [moduleName, moduleVal] of Object.entries(inst)) {
    if (moduleVal && typeof moduleVal === "object" && !Array.isArray(moduleVal)) {
      const modObj = { ...moduleVal } as ConfigValues;
      if (modObj.enabled === null || modObj.enabled === undefined) {
        delete modObj.enabled;
        changed = true;
      }
      if (Object.keys(modObj).length === 0) {
        delete inst[moduleName];
        changed = true;
      } else {
        inst[moduleName] = modObj;
      }
    } else if (moduleVal === null || moduleVal === undefined) {
      delete inst[moduleName];
      changed = true;
    }
  }

  if (!changed && Object.keys(inst).length > 0) return values;

  if (Object.keys(inst).length === 0) {
    delete ja.instrumentation;
  } else {
    ja.instrumentation = inst;
  }

  if (Object.keys(ja).length === 0) {
    delete dist.javaagent;
  } else {
    dist.javaagent = ja;
  }

  if (Object.keys(dist).length === 0) {
    const copy = { ...values };
    delete copy.distribution;
    return copy;
  } else {
    return { ...values, distribution: dist };
  }
}

/**
 * Prunes stale *owned*-scope declarative option values from the
 * `instrumentation/development` subtree (subtree B) when the agent version
 * changes. `validPaths` is a set of full dot-joined value paths (matching
 * `AggregatedConfig.path.join(".")`, e.g.
 * `"instrumentation/development.graphql.depth"`) for options that exist in
 * the newly-selected version.
 *
 * `general.*` and `java.common.*` are version-shared declarative names (see
 * `classifyScope` in declarative-name.ts) and must never be pruned by this
 * logic, so they're protected structurally by branch below rather than via
 * `validPaths` membership — an incomplete allowlist can never delete them.
 * Everything else under `instrumentation/development` is owned scope and is
 * a pruning candidate.
 *
 * `dottedPrefix` is the full path (including the `instrumentation/development`
 * root) accumulated so far, so it can be compared directly against
 * `validPaths` entries.
 */
function pruneOwnedDevValues(
  node: ConfigValues,
  validPaths: ReadonlySet<string>,
  dottedPrefix: string
): { value: ConfigValues; changed: boolean } {
  let changed = false;
  const next: ConfigValues = {};

  for (const [key, val] of Object.entries(node)) {
    const dotted = `${dottedPrefix}.${key}`;

    // `general.*` is always version-shared -- keep the whole branch verbatim.
    if (dottedPrefix === INSTRUMENTATION_DEV_KEY && key === "general") {
      next[key] = val;
      continue;
    }
    // `java.common.*` is version-shared too, but `java.*` otherwise is owned
    // scope (e.g. `java.grpc.*`), so only the `common` child of `java` is
    // protected -- everything else under `java` prunes normally below.
    if (dottedPrefix === `${INSTRUMENTATION_DEV_KEY}.java` && key === "common") {
      next[key] = val;
      continue;
    }

    if (validPaths.has(dotted)) {
      // Exact match for a currently-valid owned option: keep the whole leaf
      // verbatim, whatever its shape. Do NOT recurse into it -- a `map` or
      // `structured_list` option's internals are arbitrary user data, not
      // further declarative-name segments, and recursing would misread map
      // keys as stale option names and delete them.
      next[key] = val;
      continue;
    }

    if (isPlainObject(val)) {
      // Not itself a known leaf: either an intermediate namespace for a
      // still-valid deeper option (recurse to find out) or an orphaned
      // module/option branch (recursion empties it out entirely below).
      const result = pruneOwnedDevValues(val, validPaths, dotted);
      if (Object.keys(result.value).length > 0) {
        next[key] = result.value;
      } else {
        changed = true;
      }
      if (result.changed) changed = true;
      continue;
    }

    // Primitive/array leaf that isn't a currently-valid path: orphaned, drop it.
    changed = true;
  }

  return { value: next, changed };
}

export function configurationBuilderReducer(
  state: ConfigurationBuilderState,
  action: ConfigurationBuilderAction
): ConfigurationBuilderState {
  switch (action.type) {
    case "SET_VALUE": {
      const pathKey = serializePath(action.path);
      const remainingErrors = { ...state.validationErrors };
      delete remainingErrors[pathKey];
      return {
        ...state,
        values: cleanInstrumentation(setByPath(state.values, action.path, action.value)),
        validationErrors: remainingErrors,
        isDirty: true,
      };
    }

    case "SET_ENABLED": {
      const hasExistingValues = hasUserValues(state.values[action.section]);
      const newValues =
        action.enabled && !hasExistingValues && action.defaults
          ? { ...state.values, [action.section]: action.defaults }
          : state.values;
      return {
        ...state,
        values: newValues,
        enabledSections: { ...state.enabledSections, [action.section]: action.enabled },
        isDirty: true,
      };
    }

    case "SELECT_PLUGIN":
      return {
        ...state,
        values: setByPath(state.values, action.path, action.defaults),
        isDirty: true,
      };

    case "ADD_LIST_ITEM": {
      const currentList = getByPath(state.values, action.path);
      const arr = Array.isArray(currentList) ? [...currentList] : [];
      arr.push(action.defaultItem);
      const pathKey = serializePath(action.path);
      const currentIds = state.listItemIds ?? {};
      const existingIds = currentIds[pathKey] ?? [];
      return {
        ...state,
        values: setByPath(state.values, action.path, arr as ConfigValue),
        listItemIds: {
          ...currentIds,
          [pathKey]: [...existingIds, generateListItemId()],
        },
        isDirty: true,
      };
    }

    case "REMOVE_LIST_ITEM": {
      const list = getByPath(state.values, action.path);
      if (!Array.isArray(list)) return state;
      const newList = [...list];
      newList.splice(action.index, 1);
      const pathKey = serializePath(action.path);
      const currentIds = state.listItemIds ?? {};
      const existingIds = currentIds[pathKey];
      const nextIds = existingIds ? existingIds.filter((_, i) => i !== action.index) : existingIds;
      return {
        ...state,
        values: setByPath(state.values, action.path, newList as ConfigValue),
        listItemIds: nextIds ? { ...currentIds, [pathKey]: nextIds } : currentIds,
        isDirty: true,
      };
    }

    case "SET_MAP_ENTRY": {
      const map = getByPath(state.values, action.path);
      const currentMap: ConfigValues = isPlainObject(map) ? map : {};
      return {
        ...state,
        values: setByPath(state.values, action.path, {
          ...currentMap,
          [action.key]: action.value,
        }),
        isDirty: true,
      };
    }

    case "REMOVE_MAP_ENTRY": {
      const mapVal = getByPath(state.values, action.path);
      if (typeof mapVal !== "object" || mapVal === null || Array.isArray(mapVal)) return state;
      const rest = { ...(mapVal as ConfigValues) };
      delete rest[action.key];
      return {
        ...state,
        values: setByPath(state.values, action.path, rest),
        isDirty: true,
      };
    }

    case "LOAD_STATE": {
      const next = action.state;
      // Re-seed ids whenever the values tree is replaced wholesale so React
      // keys reflect the new items rather than a stale add/remove history.
      return { ...next, listItemIds: buildListItemIds(next.values) };
    }

    case "SET_VALIDATION_ERRORS":
      return { ...state, validationErrors: action.errors };

    case "SET_FIELD_ERROR": {
      if (action.error === null) {
        const rest = { ...state.validationErrors };
        delete rest[action.path];
        return { ...state, validationErrors: rest };
      }
      return {
        ...state,
        validationErrors: { ...state.validationErrors, [action.path]: action.error },
      };
    }

    case "ENABLE_ALL_SECTIONS": {
      const newEnabled: Record<string, boolean> = { ...state.enabledSections };
      const newValues: ConfigValues = { ...state.values };
      let changed = false;
      for (const [key, defaults] of Object.entries(action.defaultsBySection)) {
        if (newEnabled[key] !== true) {
          newEnabled[key] = true;
          changed = true;
        }
        if (!hasUserValues(newValues[key])) {
          newValues[key] = defaults;
          changed = true;
        }
      }
      if (!changed) return state;
      return { ...state, values: newValues, enabledSections: newEnabled, isDirty: true };
    }

    case "MERGE_DEFAULTS": {
      // Merge-safe bulk add: write each entry's default only where the leaf is
      // currently undefined, so values the user has already set are preserved.
      // Each setByPath builds on the previous result, so entries sharing a
      // parent path accumulate instead of clobbering each other.
      let values = state.values;
      let changed = false;
      for (const { path, value } of action.entries) {
        if (getByPath(values, path) !== undefined) continue;
        values = setByPath(values, path, value);
        changed = true;
      }
      if (!changed) return state;
      return { ...state, values, isDirty: true };
    }

    case "PRUNE_INSTRUMENTATIONS": {
      let values = state.values;
      let changed = false;

      // Subtree A: distribution.javaagent.instrumentation.<module> enable/disable flags.
      const currentInst = getByPath(values, INSTRUMENTATION_PATH);
      if (isPlainObject(currentInst)) {
        const validModules = new Set(action.validModules);
        const nextInst: ConfigValues = { ...currentInst };
        let instChanged = false;

        for (const key of Object.keys(nextInst)) {
          if (!validModules.has(key)) {
            delete nextInst[key];
            instChanged = true;
          }
        }

        if (instChanged) {
          changed = true;
          values = setByPath(values, INSTRUMENTATION_PATH, nextInst);
        }
      }

      // Subtree B: instrumentation/development.* declarative option values.
      const currentDev = getByPath(values, INSTRUMENTATION_DEV_PATH);
      if (isPlainObject(currentDev)) {
        const validPaths = new Set(action.validOwnedConfigPaths);
        const { value: nextDev, changed: devChanged } = pruneOwnedDevValues(
          currentDev,
          validPaths,
          INSTRUMENTATION_DEV_KEY
        );

        if (devChanged) {
          changed = true;
          if (Object.keys(nextDev).length === 0) {
            const rest = { ...values };
            delete rest[INSTRUMENTATION_DEV_KEY];
            values = rest;
          } else {
            values = setByPath(values, INSTRUMENTATION_DEV_PATH, nextDev);
          }
        }
      }

      if (!changed) return state;

      return {
        ...state,
        values: cleanInstrumentation(values),
      };
    }

    default:
      return state;
  }
}
