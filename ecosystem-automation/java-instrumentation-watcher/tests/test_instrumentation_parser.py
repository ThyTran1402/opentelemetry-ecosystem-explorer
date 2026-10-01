# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Tests for instrumentation parser system."""

import pytest
from java_instrumentation_watcher.instrumentation_parser import (
    InstrumentationParser,
    ParserFactory,
    ParserV01,
    ParserV02,
    ParserV03,
    ParserV05,
    ParserV06,
    ParserV08,
    parse_instrumentation_yaml,
)


class TestParserV01:
    def test_get_file_format(self):
        parser = ParserV01()
        assert parser.get_file_format() == 0.1

    def test_parse_basic_yaml(self):
        yaml_content = """
file_format: 0.1
libraries:
  akka:
  - id: akka-actor
    name: Akka Actor
"""
        parser = ParserV01()
        data = parser.parse(yaml_content)

        assert data["file_format"] == 0.1
        assert "libraries" in data
        assert isinstance(data["libraries"], list)
        assert len(data["libraries"]) == 1
        assert data["libraries"][0]["id"] == "akka-actor"
        assert data["libraries"][0]["tags"] == ["akka"]

    def test_parse_cleans_trailing_whitespace(self):
        yaml_content = """
file_format: 0.1
libraries:
  test:
  - name: Test Instrumentation
    description: 'This has trailing whitespace.

        '
"""
        parser = ParserV01()
        data = parser.parse(yaml_content)

        assert data["libraries"][0]["description"] == "This has trailing whitespace."
        assert data["libraries"][0]["tags"] == ["test"]

    def test_parse_cleans_nested_strings(self):
        yaml_content = """
file_format: 0.1
libraries:
  test:
  - name: '  Test with spaces  '
    configurations:
    - name: '  config.name  '
      description: '  Nested description  '
"""
        parser = ParserV01()
        data = parser.parse(yaml_content)

        test_lib = data["libraries"][0]
        assert test_lib["name"] == "Test with spaces"
        assert test_lib["tags"] == ["test"]
        assert test_lib["configurations"][0]["name"] == "config.name"
        assert test_lib["configurations"][0]["description"] == "Nested description"

    def test_parse_preserves_intentional_multiline(self):
        yaml_content = """
file_format: 0.1
libraries:
  test:
  - description: |-
      Line one
      Line two
      Line three
"""
        parser = ParserV01()
        data = parser.parse(yaml_content)

        # Should preserve intentional line breaks but strip outer whitespace
        desc = data["libraries"][0]["description"]
        assert "Line one" in desc
        assert "Line two" in desc
        assert "Line three" in desc
        assert data["libraries"][0]["tags"] == ["test"]

    def test_parse_empty_yaml(self):
        parser = ParserV01()
        data = parser.parse("")
        assert data == {}

    def test_parse_malformed_yaml(self):
        yaml_content = """
file_format: 0.1
libraries:
  test: [unclosed
"""
        parser = ParserV01()
        with pytest.raises(ValueError, match="Error parsing instrumentation YAML"):
            parser.parse(yaml_content)

    def test_clean_strings_with_dict(self):
        parser = ParserV01()
        data = {"key": "  value  ", "nested": {"inner": "  inner value  "}}
        cleaned = parser._clean_strings(data)

        assert cleaned["key"] == "value"
        assert cleaned["nested"]["inner"] == "inner value"

    def test_clean_strings_with_list(self):
        parser = ParserV01()
        data = ["  item1  ", "  item2  "]
        cleaned = parser._clean_strings(data)

        assert cleaned == ["item1", "item2"]

    def test_clean_strings_preserves_non_strings(self):
        parser = ParserV01()
        data = {"int": 42, "float": 3.14, "bool": True, "none": None}
        cleaned = parser._clean_strings(data)

        assert cleaned["int"] == 42
        assert cleaned["float"] == 3.14
        assert cleaned["bool"] is True
        assert cleaned["none"] is None


class TestParserV02:
    def test_get_file_format(self):
        parser = ParserV02()
        assert parser.get_file_format() == 0.2

    def test_parse_basic_yaml(self):
        yaml_content = """
file_format: 0.2
libraries:
  akka:
  - name: akka-actor
    javaagent_target_versions:
    - com.typesafe.akka:akka-actor:[2.3,)
"""
        parser = ParserV02()
        data = parser.parse(yaml_content)

        assert data["file_format"] == 0.2
        assert isinstance(data["libraries"], list)
        assert len(data["libraries"]) == 1
        assert data["libraries"][0]["name"] == "akka-actor"
        assert data["libraries"][0]["tags"] == ["akka"]
        assert "javaagent_target_versions" in data["libraries"][0]

    def test_parse_flattens_libraries(self):
        yaml_content = """
file_format: 0.2
libraries:
  activej:
  - name: activej-http-6.0
    javaagent_target_versions:
    - io.activej:activej-http:[6.0,)
  akka:
  - name: akka-actor
    javaagent_target_versions:
    - com.typesafe.akka:akka-actor:[2.3,)
"""
        parser = ParserV02()
        data = parser.parse(yaml_content)

        assert isinstance(data["libraries"], list)
        assert len(data["libraries"]) == 2
        assert data["libraries"][0]["tags"] == ["activej"]
        assert data["libraries"][1]["tags"] == ["akka"]


class TestParserV03:
    def test_get_file_format(self):
        parser = ParserV03()
        assert parser.get_file_format() == 0.3

    def test_parse_renames_type_to_data_type(self):
        yaml_content = """
file_format: 0.3
libraries:
  test:
  - name: test-lib
    metrics:
    - name: test.metric
      type: LONG_SUM
      instrument: counter
"""
        parser = ParserV03()
        data = parser.parse(yaml_content)

        metric = data["libraries"][0]["metrics"][0]
        assert "data_type" in metric
        assert "type" not in metric
        assert metric["data_type"] == "LONG_SUM"


class TestParserV05:
    parser = ParserV05()
    assert parser.get_file_format() == 0.5

    def test_parse_new_fields(self):
        yaml_content = """
        file_format: 0.5
        libraries:
        - name: activej-http-6.0
          display_name: ActiveJ
          description: This instrumentation enables HTTP server spans and HTTP server metrics
            for the ActiveJ HTTP server.
          semantic_conventions:
          - HTTP_SERVER_SPANS
          - HTTP_SERVER_METRICS
          library_link: https://activej.io/
          source_path: instrumentation/activej-http-6.0
          minimum_java_version: 17
          scope:
            name: io.opentelemetry.activej-http-6.0
            schema_url: https://opentelemetry.io/schemas/1.37.0
          has_javaagent: true
          javaagent_target_versions:
          - io.activej:activej-http:[6.0,)
          configurations:
          - name: otel.instrumentation.http.known-methods
            declarative_name: java.common.http.known_methods
            description: Configures the instrumentation
            type: list
            default: CONNECT,DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT,TRACE
            examples:
            - value1
            - value2
            """
        parser = ParserV03()
        data = parser.parse(yaml_content)

        lib = data["libraries"][0]
        config = lib["configurations"][0]
        assert "declarative_name" in config
        assert config["declarative_name"] == "java.common.http.known_methods"
        assert config["examples"] == ["value1", "value2"]

        assert "has_javaagent" in lib
        assert lib["has_javaagent"] is True


class TestParserV06:
    def test_get_file_format(self):
        parser = ParserV06()
        assert parser.get_file_format() == 0.6

    def test_parse_preserves_definitions_and_refs(self):
        # 0.6 hoists shared configs/metrics into a top-level ``definitions`` catalog
        # and references them by id. The parser must preserve this compact shape
        # verbatim (resolution happens downstream in the db-builder).
        yaml_content = """
file_format: 0.6
definitions:
  configurations:
    http.known-methods:
      name: otel.instrumentation.http.known-methods
      declarative_name: java.common.http.known_methods
      description: '  Configures known methods.  '
      type: list
      default: GET,POST
  metrics:
    http.server.request.duration-639e2d0b:
      name: http.server.request.duration
      description: Duration of HTTP server requests.
      instrument: histogram
      data_type: HISTOGRAM
      unit: s
libraries:
- name: activej-http-6.0
  display_name: ActiveJ
  configuration_refs:
  - http.known-methods
  telemetry:
  - when: default
    metric_refs:
    - http.server.request.duration-639e2d0b
"""
        parser = ParserV06()
        data = parser.parse(yaml_content)

        assert data["file_format"] == 0.6
        # Catalog is preserved and whitespace cleaned.
        assert data["definitions"]["configurations"]["http.known-methods"]["description"] == "Configures known methods."
        assert "http.server.request.duration-639e2d0b" in data["definitions"]["metrics"]
        # Libraries stay a flat list and keep their references (not resolved here).
        lib = data["libraries"][0]
        assert lib["name"] == "activej-http-6.0"
        assert lib["configuration_refs"] == ["http.known-methods"]
        assert lib["telemetry"][0]["metric_refs"] == ["http.server.request.duration-639e2d0b"]
        # No inline resolution happened in the parser.
        assert "configurations" not in lib
        assert "metrics" not in lib["telemetry"][0]


class TestParserV08:
    def test_get_file_format(self):
        parser = ParserV08()
        assert parser.get_file_format() == 0.8

    def test_parse_preserves_new_fields(self):
        # 0.7 and 0.8 add an events catalog, deprecation markers, optional defaults and a
        # top-level list of agent-wide configs. All of it is kept as-is, refs unresolved.
        yaml_content = """
file_format: 0.8
definitions:
  configurations:
    common.db.query-sanitization.enabled:
      name: otel.instrumentation.common.db.query-sanitization.enabled
      declarative_name: java.common.db.query_sanitization.enabled
      description: Enables query sanitization for database queries.
      type: boolean
      default: true
    otel.instrumentation.jdbc.query-sanitization.enabled:
      name: otel.instrumentation.jdbc.query-sanitization.enabled
      declarative_name: java.jdbc.query_sanitization.enabled
      description: '  Overrides the common setting; when unset, that setting applies.  '
      type: boolean
    otel.instrumentation.jdbc.statement-sanitizer.enabled:
      name: otel.instrumentation.jdbc.statement-sanitizer.enabled
      description: 'Deprecated: use `otel.instrumentation.jdbc.query-sanitization.enabled` instead.'
      type: boolean
      deprecated: true
      replaced_by: otel.instrumentation.jdbc.query-sanitization.enabled
    span-suppression-strategy:
      name: otel.instrumentation.common.span-suppression-strategy
      declarative_name: java.common.span_suppression_strategy
      description: Span suppression strategy.
      type: string
      default: semconv
  events:
    db.client.operation.exception-83d4cffb:
      name: db.client.operation.exception
      severity: WARN
      attributes:
      - name: exception.type
        type: STRING
global_configuration_refs:
- span-suppression-strategy
libraries:
- name: jdbc
  configuration_refs:
  - common.db.query-sanitization.enabled
  - otel.instrumentation.jdbc.query-sanitization.enabled
  - otel.instrumentation.jdbc.statement-sanitizer.enabled
  telemetry:
  - when: otel.semconv.exception.signal.preview=logs
    event_refs:
    - db.client.operation.exception-83d4cffb
"""
        parser = ParserV08()
        data = parser.parse(yaml_content)

        assert data["file_format"] == 0.8
        configs = data["definitions"]["configurations"]
        override = configs["otel.instrumentation.jdbc.query-sanitization.enabled"]
        assert "default" not in override
        assert override["description"] == "Overrides the common setting; when unset, that setting applies."
        deprecated = configs["otel.instrumentation.jdbc.statement-sanitizer.enabled"]
        assert deprecated["deprecated"] is True
        assert deprecated["replaced_by"] == "otel.instrumentation.jdbc.query-sanitization.enabled"
        assert data["definitions"]["events"]["db.client.operation.exception-83d4cffb"]["severity"] == "WARN"
        assert data["global_configuration_refs"] == ["span-suppression-strategy"]
        telemetry = data["libraries"][0]["telemetry"][0]
        assert telemetry["event_refs"] == ["db.client.operation.exception-83d4cffb"]
        assert "events" not in telemetry


class TestParserFactory:
    def test_get_parser_v0_1(self):
        parser = ParserFactory.get_parser(0.1)
        assert isinstance(parser, ParserV01)
        assert parser.get_file_format() == 0.1

    def test_get_parser_v0_2(self):
        parser = ParserFactory.get_parser(0.2)
        assert isinstance(parser, ParserV02)
        assert parser.get_file_format() == 0.2

    def test_get_parser_v0_3(self):
        parser = ParserFactory.get_parser(0.3)
        assert isinstance(parser, ParserV03)
        assert parser.get_file_format() == 0.3

    def test_get_parser_unsupported_version(self):
        with pytest.raises(ValueError, match="Unsupported file_format: 999.0"):
            ParserFactory.get_parser(999.0)

    def test_get_parser_v0_6(self):
        parser = ParserFactory.get_parser(0.6)
        assert isinstance(parser, ParserV06)
        assert parser.get_file_format() == 0.6

    def test_get_parser_v0_8(self):
        parser = ParserFactory.get_parser(0.8)
        assert isinstance(parser, ParserV08)
        assert parser.get_file_format() == 0.8

    def test_get_default_parser(self):
        parser = ParserFactory.get_default_parser()
        assert isinstance(parser, InstrumentationParser)
        # Should return the latest version
        assert parser.get_file_format() == 0.8


class TestParseInstrumentationYaml:
    def test_parse_with_explicit_version(self):
        yaml_content = """
file_format: 0.1
libraries: {}
"""
        data = parse_instrumentation_yaml(yaml_content, file_format=0.1)
        assert data["file_format"] == 0.1

    def test_parse_with_auto_detection(self):
        yaml_content = """
file_format: 0.1
libraries:
  test:
  - name: '  Test  '
"""
        data = parse_instrumentation_yaml(yaml_content)
        assert data["file_format"] == 0.1
        assert data["libraries"][0]["name"] == "Test"
        assert data["libraries"][0]["tags"] == ["test"]

    def test_parse_without_file_format_uses_default(self):
        yaml_content = """
libraries:
  test:
  - name: Test
"""
        # Should use default parser when file_format not present
        data = parse_instrumentation_yaml(yaml_content)
        assert "libraries" in data

    def test_parse_with_malformed_yaml_uses_default(self):
        # When auto-detection fails due to malformed YAML,
        # should fall back to default parser (which will then fail appropriately)
        yaml_content = "invalid: [yaml"
        with pytest.raises(ValueError, match="Error parsing instrumentation YAML"):
            parse_instrumentation_yaml(yaml_content)
