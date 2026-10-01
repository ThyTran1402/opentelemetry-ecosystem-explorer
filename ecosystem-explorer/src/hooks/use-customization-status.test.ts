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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { InstrumentationModule } from "@/types/javaagent";
import { useConfigurationBuilder } from "./use-configuration-builder";
import { useCustomizationStatusMap } from "./use-customization-status";

vi.mock("./use-configuration-builder");

const mocked = vi.mocked(useConfigurationBuilder);

function modulesNamed(...names: string[]): InstrumentationModule[] {
  return names.map((name) => ({ name, defaultDisabled: false, coveredEntries: [] }));
}

const ALL_MODULES = modulesNamed("jmx_metrics", "cassandra", "kafka_clients");

function fakeBuilderState(
  modules: Record<string, { enabled?: boolean }> = {}
): ReturnType<typeof useConfigurationBuilder> {
  return {
    state: {
      version: "1.0.0",
      values: {
        distribution: {
          javaagent: {
            instrumentation: modules,
          },
        },
      },
      enabledSections: {},
      validationErrors: {},
      isDirty: false,
      listItemIds: {},
    },
  } as unknown as ReturnType<typeof useConfigurationBuilder>;
}

describe("useCustomizationStatusMap", () => {
  beforeEach(() => mocked.mockReset());

  it("returns an empty map when there are no customizations", () => {
    mocked.mockReturnValue(fakeBuilderState());
    const { result } = renderHook(() => useCustomizationStatusMap(ALL_MODULES));
    expect(result.current.size).toBe(0);
  });

  it("maps each module name to its status", () => {
    mocked.mockReturnValue(
      fakeBuilderState({
        jmx_metrics: { enabled: true },
        cassandra: { enabled: false },
        kafka_clients: { enabled: false },
      })
    );
    const { result } = renderHook(() => useCustomizationStatusMap(ALL_MODULES));
    expect(result.current.get("cassandra")).toBe("disabled");
    expect(result.current.get("jmx_metrics")).toBe("enabled");
    expect(result.current.get("kafka_clients")).toBe("disabled");
    expect(result.current.size).toBe(3);
  });

  it("leaves out modules absent from the selected agent version", () => {
    mocked.mockReturnValue(
      fakeBuilderState({
        jmx_metrics: { enabled: true },
        jaxws_cxf: { enabled: false },
      })
    );
    const modules = modulesNamed("jmx_metrics");
    const { result } = renderHook(() => useCustomizationStatusMap(modules));
    expect([...result.current]).toEqual([["jmx_metrics", "enabled"]]);
  });
});

describe("useCustomizationStatusMap memoization", () => {
  beforeEach(() => mocked.mockReset());

  it("returns the same Map reference across re-renders when state.values is unchanged", () => {
    mocked.mockReturnValue(
      fakeBuilderState({
        jmx_metrics: { enabled: true },
        cassandra: { enabled: false },
      })
    );
    const { result, rerender } = renderHook(() => useCustomizationStatusMap(ALL_MODULES));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
