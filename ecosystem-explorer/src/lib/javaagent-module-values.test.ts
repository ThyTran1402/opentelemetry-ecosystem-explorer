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
import { describe, it, expect } from "vitest";
import type { ConfigValues } from "@/types/configuration-builder";
import { filterJavaagentModuleValues } from "./javaagent-module-values";

function withModules(instrumentation: ConfigValues, extra: ConfigValues = {}): ConfigValues {
  return { ...extra, distribution: { javaagent: { instrumentation } } };
}

function filter(values: ConfigValues, validModules: string[]): ConfigValues {
  return filterJavaagentModuleValues(values, new Set(validModules));
}

describe("filterJavaagentModuleValues", () => {
  it("drops a module absent from the allowlist and keeps a valid one", () => {
    const before = withModules({ jaxws_cxf: { enabled: false }, jdbc: { enabled: true } });
    expect(filter(before, ["jdbc"])).toEqual(withModules({ jdbc: { enabled: true } }));
  });

  it("removes distribution entirely when every module is dropped", () => {
    const before = withModules({ jaxws_cxf: { enabled: false } }, { resource: { a: 1 } });
    expect(filter(before, ["jdbc"])).toEqual({ resource: { a: 1 } });
  });

  it("keeps sibling keys of instrumentation and javaagent", () => {
    const before: ConfigValues = {
      distribution: {
        javaagent: { instrumentation: { jaxws_cxf: { enabled: false } }, other: true },
        spring_starter: { x: 1 },
      },
    };
    expect(filter(before, [])).toEqual({
      distribution: { javaagent: { other: true }, spring_starter: { x: 1 } },
    });
  });

  it("returns the same reference when nothing is dropped", () => {
    const before = withModules({ jdbc: { enabled: true } });
    expect(filter(before, ["jdbc"])).toBe(before);
  });

  it("returns the same reference when the instrumentation path is absent", () => {
    const before: ConfigValues = { distribution: { javaagent: {} } };
    expect(filter(before, [])).toBe(before);
    const empty: ConfigValues = {};
    expect(filter(empty, [])).toBe(empty);
  });

  it("does not mutate the input", () => {
    const before = withModules({ jaxws_cxf: { enabled: false }, jdbc: { enabled: true } });
    const snapshot = structuredClone(before);
    filter(before, ["jdbc"]);
    expect(before).toEqual(snapshot);
  });
});
