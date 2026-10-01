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

import { describe, expect, it, vi } from "vitest";

import { loadIndex, loadVersions } from "@/lib/api/collector-data";
import type { IndexComponent } from "@/types/collector";
import { collectorSearchSource, toCollectorResult } from "./collector";

vi.mock("@/lib/api/collector-data", () => ({
  loadIndex: vi.fn(),
  loadVersions: vi.fn(),
}));

function makeComponent(overrides: Partial<IndexComponent> = {}): IndexComponent {
  return {
    id: "core-receiver-otlp",
    name: "otlp",
    distribution: "core",
    type: "receiver",
    display_name: "OTLP Receiver",
    description: "Receives telemetry over OTLP",
    stability: "stable",
    ...overrides,
  };
}

describe("toCollectorResult", () => {
  it("maps a component to a collector search result with a type facet", () => {
    const result = toCollectorResult(makeComponent(), "2.0.0");

    expect(result).toMatchObject({
      title: "OTLP Receiver",
      path: "/collector/components/core/otlp?version=2.0.0",
      type: "item",
      ecosystem: "collector",
      facets: ["receiver"],
      stability: "stable",
      version: "2.0.0",
    });
    expect(result.keywords).toEqual(["core-receiver-otlp", "otlp", "core", "receiver"]);
  });

  it("returns undefined stability when the index omits it", () => {
    const result = toCollectorResult(makeComponent({ stability: null }), "2.0.0");

    expect(result.stability).toBeUndefined();
  });

  it("falls back to the component name when display_name is absent", () => {
    const result = toCollectorResult(
      makeComponent({ display_name: null, name: "zipkin" }),
      "2.0.0"
    );

    expect(result.title).toBe("zipkin");
  });
});

describe("collectorSearchSource", () => {
  it("resolves per-distribution latest versions when distributions are out of sync", async () => {
    vi.mocked(loadVersions).mockResolvedValue({
      versions: [
        { version: "0.161.0", is_latest: true, distributions: ["core"] },
        { version: "0.160.0", is_latest: false, distributions: ["core", "contrib"] },
      ],
      distributions: {
        core: { latest: "0.161.0" },
        contrib: { latest: "0.160.0" },
      },
    });
    vi.mocked(loadIndex).mockResolvedValue({
      ecosystem: "collector",
      taxonomy: { distributions: ["core", "contrib"], types: ["receiver"] },
      components: [
        makeComponent({ distribution: "core", name: "otlp", id: "core-receiver-otlp" }),
        makeComponent({
          distribution: "contrib",
          name: "kafka",
          id: "contrib-receiver-kafka",
          display_name: "Kafka Receiver",
        }),
      ],
    });

    const results = await collectorSearchSource.load();
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.title === "OTLP Receiver")?.version).toBe("0.161.0");
    expect(results.find((r) => r.title === "OTLP Receiver")?.path).toBe(
      "/collector/components/core/otlp?version=0.161.0"
    );
    expect(results.find((r) => r.title === "Kafka Receiver")?.version).toBe("0.160.0");
    expect(results.find((r) => r.title === "Kafka Receiver")?.path).toBe(
      "/collector/components/contrib/kafka?version=0.160.0"
    );
  });
});
