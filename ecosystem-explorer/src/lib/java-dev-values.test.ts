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
import { filterJavaDevValues } from "./java-dev-values";

const DEV = "instrumentation/development";

function withDev(dev: ConfigValues, extra: ConfigValues = {}): ConfigValues {
  return { ...extra, [DEV]: dev };
}

function filter(values: ConfigValues, validNames: string[]): ConfigValues {
  return filterJavaDevValues(values, new Set(validNames));
}

describe("filterJavaDevValues", () => {
  it("drops an owned option absent from the allowlist and keeps a valid one", () => {
    const before = withDev({
      java: { graphql: { query_sanitizer: { enabled: false } }, kafka: { x: true } },
    });
    expect(filter(before, ["java.kafka.x"])[DEV]).toEqual({ java: { kafka: { x: true } } });
  });

  it("filters java.common.* against the allowlist like owned options", () => {
    const before = withDev({
      java: {
        common: {
          user: { name: { enabled: true } },
          db: { query_sanitization: { enabled: false } },
        },
      },
    });
    expect(filter(before, ["java.common.db.query_sanitization.enabled"])[DEV]).toEqual({
      java: { common: { db: { query_sanitization: { enabled: false } } } },
    });
  });

  it("keeps general.* verbatim even with an empty allowlist", () => {
    const general = { http: { client: { request_captured_headers: ["x-a"] } } };
    const before = withDev({ general, java: { cassandra: { x: 1 } } });
    expect(filter(before, [])[DEV]).toEqual({ general });
  });

  it("leaves non-java language keys untouched", () => {
    const before = withDev({ python: { foo: 1 }, java: { gone: true } });
    expect(filter(before, [])[DEV]).toEqual({ python: { foo: 1 } });
  });

  it("keeps a valid map-typed option's user entries instead of recursing into them", () => {
    const mapping = { "10.0.0.1": "db", "10.0.0.2": "cache" };
    const before = withDev({ java: { common: { service_peer_mapping: mapping } } });
    expect(filter(before, ["java.common.service_peer_mapping"])).toBe(before);
  });

  it("treats list values as atomic leaves", () => {
    const before = withDev({
      java: { a: { rules: [{ pattern: "x" }] }, b: { rules: [{ pattern: "y" }] } },
    });
    expect(filter(before, ["java.a.rules"])[DEV]).toEqual({
      java: { a: { rules: [{ pattern: "x" }] } },
    });
  });

  it("recurses through deep names and removes emptied intermediate branches", () => {
    const before = withDev({
      java: {
        common: {
          messaging: {
            batch_send: { message_creation_spans: { enabled: true } },
            "headers/development": { included: ["a"] },
          },
        },
      },
    });
    expect(
      filter(before, ["java.common.messaging.batch_send.message_creation_spans.enabled"])[DEV]
    ).toEqual({
      java: {
        common: { messaging: { batch_send: { message_creation_spans: { enabled: true } } } },
      },
    });
  });

  it("removes the whole instrumentation/development key when nothing remains", () => {
    const before = withDev({ java: { graphql: { depth: 3 } } }, { resource: { a: 1 } });
    const after = filter(before, []);
    expect(after[DEV]).toBeUndefined();
    expect(after.resource).toEqual({ a: 1 });
  });

  it("returns the same reference when every value is still valid", () => {
    const before = withDev({
      general: { x: 1 },
      java: { kafka: { x: true }, common: { http: { known_methods: ["GET"] } } },
    });
    expect(filter(before, ["java.kafka.x", "java.common.http.known_methods"])).toBe(before);
  });

  it("returns the same reference when there is no java branch", () => {
    const before = withDev({ general: { x: 1 } });
    expect(filter(before, [])).toBe(before);
    const empty: ConfigValues = { resource: { a: 1 } };
    expect(filter(empty, [])).toBe(empty);
  });

  it("does not mutate its input", () => {
    const before = withDev({ java: { gone: 1, kept: 2 } });
    const snapshot = structuredClone(before);
    filter(before, ["java.kept"]);
    expect(before).toEqual(snapshot);
  });
});
