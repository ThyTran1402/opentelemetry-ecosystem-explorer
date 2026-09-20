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
import type { InstrumentationListEntry, InstrumentationModule } from "@/types/javaagent";
import { aggregateConfigurations, collectOwnedConfigPathKeys } from "./configurations-aggregate";

function makeEntry(
  name: string,
  configs: InstrumentationListEntry["configurations"]
): InstrumentationListEntry {
  return {
    name,
    scope: { name: `io.opentelemetry.${name}` },
    configurations: configs,
    has_spans: false,
    has_metrics: false,
    _is_custom: false,
  };
}

function makeModule(
  name: string,
  coveredEntries: InstrumentationListEntry[]
): InstrumentationModule {
  return { name, defaultDisabled: false, coveredEntries };
}

describe("aggregateConfigurations", () => {
  it("returns empty array when no covered entry has configurations", () => {
    const mod = makeModule("akka_actor", [makeEntry("akka-actor-2.3", undefined)]);
    expect(aggregateConfigurations(mod)).toEqual([]);
  });

  it("drops entries without declarative_name", () => {
    const mod = makeModule("akka_http", [
      makeEntry("akka-http-10.0", [
        {
          name: "otel.instrumentation.http.no-declarative",
          description: "env-var only",
          type: "boolean",
          default: false,
        },
        {
          name: "otel.instrumentation.http.known-methods",
          declarative_name: "java.common.http.known_methods",
          description: "Recognized methods",
          type: "list",
          default: "GET,POST",
        },
      ]),
    ]);
    const out = aggregateConfigurations(mod);
    expect(out).toHaveLength(1);
    expect(out[0].entry.declarative_name).toBe("java.common.http.known_methods");
  });

  it("dedupes by declarative_name, preferring the latest covered version", () => {
    const mod = makeModule("cassandra", [
      makeEntry("cassandra-3.0", [
        {
          name: "otel.x",
          declarative_name: "java.common.db.query_sanitization.enabled",
          description: "older description",
          type: "boolean",
          default: true,
        },
      ]),
      makeEntry("cassandra-4.4", [
        {
          name: "otel.x",
          declarative_name: "java.common.db.query_sanitization.enabled",
          description: "newer description",
          type: "boolean",
          default: true,
        },
      ]),
    ]);
    const out = aggregateConfigurations(mod);
    expect(out).toHaveLength(1);
    expect(out[0].entry.description).toBe("newer description");
  });

  it("orders general first, then java.common, then owned", () => {
    const mod = makeModule("graphql_java", [
      makeEntry("graphql-java-20.0", [
        {
          name: "owned-1",
          declarative_name: "java.graphql.capture_query",
          description: "",
          type: "boolean",
          default: true,
        },
        {
          name: "general-1",
          declarative_name: "general.http.server.request_captured_headers",
          description: "",
          type: "list",
          default: "",
        },
        {
          name: "common-1",
          declarative_name: "java.common.http.known_methods",
          description: "",
          type: "list",
          default: "",
        },
      ]),
    ]);
    const out = aggregateConfigurations(mod);
    expect(out.map((c) => c.scope)).toEqual(["general", "common", "owned"]);
  });

  it("populates path from declarative_name", () => {
    const mod = makeModule("graphql_java", [
      makeEntry("graphql-java-20.0", [
        {
          name: "owned-1",
          declarative_name: "java.graphql.capture_query",
          description: "",
          type: "boolean",
          default: true,
        },
      ]),
    ]);
    const out = aggregateConfigurations(mod);
    expect(out[0].path).toEqual([
      "instrumentation/development",
      "java",
      "graphql",
      "capture_query",
    ]);
  });
});

describe("collectOwnedConfigPathKeys", () => {
  it("returns only owned-scope paths, excluding general.* and java.common.*", () => {
    const mod = makeModule("graphql_java", [
      makeEntry("graphql-java-20.0", [
        {
          name: "owned-1",
          declarative_name: "java.graphql.capture_query",
          description: "",
          type: "boolean",
          default: true,
        },
        {
          name: "general-1",
          declarative_name: "general.http.server.request_captured_headers",
          description: "",
          type: "list",
          default: "",
        },
        {
          name: "common-1",
          declarative_name: "java.common.http.known_methods",
          description: "",
          type: "list",
          default: "",
        },
      ]),
    ]);
    expect(collectOwnedConfigPathKeys([mod])).toEqual([
      "instrumentation/development.java.graphql.capture_query",
    ]);
  });

  it("includes an owned option whose default is empty", () => {
    const mod = makeModule("graphql_java", [
      makeEntry("graphql-java-20.0", [
        {
          name: "owned-empty-default",
          declarative_name: "graphql.error_extensions",
          description: "",
          type: "string",
          default: "",
        },
      ]),
    ]);
    expect(collectOwnedConfigPathKeys([mod])).toEqual([
      "instrumentation/development.graphql.error_extensions",
    ]);
  });

  it("dedupes a declarative name shared across modules into a single key", () => {
    const modA = makeModule("cassandra", [
      makeEntry("cassandra-3.0", [
        {
          name: "otel.x",
          declarative_name: "graphql.depth",
          description: "",
          type: "int",
          default: 0,
        },
      ]),
    ]);
    const modB = makeModule("cassandra_ext", [
      makeEntry("cassandra-ext-1.0", [
        {
          name: "otel.y",
          declarative_name: "graphql.depth",
          description: "",
          type: "int",
          default: 0,
        },
      ]),
    ]);
    expect(collectOwnedConfigPathKeys([modA, modB])).toEqual([
      "instrumentation/development.graphql.depth",
    ]);
  });
});
