import { describe, expect, it } from "vitest";
import { SetupOutputRepository } from "../../src/modules/session-agent/repositories/setup-output.repository";
import type { SqlFn } from "../../src/modules/session-agent/repositories/repository.types";

interface OutputRow {
  stream: string;
  seq: number;
  data: string;
}

function createSql() {
  const rows: OutputRow[] = [];
  const sql = ((
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    if (query.includes("COALESCE(MAX(seq)")) {
      const [stream, , data] = values as [string, string, string];
      const maxSeq = rows
        .filter((row) => row.stream === stream)
        .reduce((max, row) => Math.max(max, row.seq), -1);
      rows.push({ stream, seq: maxSeq + 1, data });
      return [];
    }
    if (query.startsWith("INSERT INTO setup_script_output_chunks")) {
      const [stream, data] = values as [string, string];
      rows.push({ stream, seq: 0, data });
      return [];
    }
    if (query.includes("SELECT data FROM")) {
      const [stream] = values as [string];
      return rows
        .filter((row) => row.stream === stream)
        .sort((a, b) => a.seq - b.seq)
        .map((row) => ({ data: row.data }));
    }
    if (query.includes("SUM(LENGTH(data))")) {
      const [stream] = values as [string];
      const matching = rows.filter((row) => row.stream === stream);
      const total = matching.length === 0
        ? null
        : matching.reduce((sum, row) => sum + row.data.length, 0);
      return [{ total }];
    }
    if (query.includes("COUNT(*)")) {
      return [{ count: rows.length }];
    }
    if (query.startsWith("DELETE FROM setup_script_output_chunks WHERE")) {
      const [stream] = values as [string];
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index]!.stream === stream) {
          rows.splice(index, 1);
        }
      }
      return [];
    }
    if (query.startsWith("DELETE FROM setup_script_output_chunks")) {
      rows.length = 0;
      return [];
    }
    throw new Error(`Unhandled query: ${query}`);
  }) as SqlFn;

  return { rows, sql };
}

describe("SetupOutputRepository", () => {
  it("appends batches and reads them back in order", () => {
    const { sql } = createSql();
    const repository = new SetupOutputRepository(sql);

    repository.append("stdout", "line 1\n");
    repository.append("stderr", "warn 1\n");
    repository.append("stdout", "line 2\n");

    expect(repository.read("stdout")).toBe("line 1\nline 2\n");
    expect(repository.read("stderr")).toBe("warn 1\n");
  });

  it("reports per-stream total lengths", () => {
    const { sql } = createSql();
    const repository = new SetupOutputRepository(sql);

    expect(repository.totalLength("stdout")).toBe(0);

    repository.append("stdout", "12345");
    repository.append("stdout", "678");

    expect(repository.totalLength("stdout")).toBe(8);
    expect(repository.totalLength("stderr")).toBe(0);
  });

  it("reports whether any output exists", () => {
    const { sql } = createSql();
    const repository = new SetupOutputRepository(sql);

    expect(repository.hasOutput()).toBe(false);
    repository.append("stderr", "warn\n");
    expect(repository.hasOutput()).toBe(true);
  });

  it("compacts a stream into a single row without changing its content", () => {
    const { rows, sql } = createSql();
    const repository = new SetupOutputRepository(sql);

    repository.append("stdout", "a");
    repository.append("stdout", "b");
    repository.append("stderr", "x");
    repository.compact("stdout");

    expect(rows.filter((row) => row.stream === "stdout")).toHaveLength(1);
    expect(repository.read("stdout")).toBe("ab");
    expect(repository.read("stderr")).toBe("x");
  });

  it("clears all stored output", () => {
    const { sql } = createSql();
    const repository = new SetupOutputRepository(sql);

    repository.append("stdout", "a");
    repository.append("stderr", "b");
    repository.clear();

    expect(repository.read("stdout")).toBe("");
    expect(repository.read("stderr")).toBe("");
    expect(repository.hasOutput()).toBe(false);
  });
});
