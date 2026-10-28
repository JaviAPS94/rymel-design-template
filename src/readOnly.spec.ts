import { describe, expect, it } from "vitest";
import { isReadOnly } from "./readOnly.js";

describe("isReadOnly", () => {
  const zona = { startCell: "B3", endCell: "C10" };

  it("protege las celdas dentro de la zona, bordes incluidos", () => {
    const sheet = { readOnlyZones: [zona] };
    expect(isReadOnly(sheet, "B3")).toBe(true);
    expect(isReadOnly(sheet, "C10")).toBe(true);
    expect(isReadOnly(sheet, "c5")).toBe(true);
  });

  it("no protege lo que queda fuera", () => {
    const sheet = { readOnlyZones: [zona] };
    expect(isReadOnly(sheet, "A3")).toBe(false);
    expect(isReadOnly(sheet, "B11")).toBe(false);
    expect(isReadOnly(sheet, "D3")).toBe(false);
  });

  it("sin zonas no protege nada", () => {
    expect(isReadOnly({}, "A1")).toBe(false);
    expect(isReadOnly({ readOnlyZones: [] }, "A1")).toBe(false);
  });

  it("acepta una zona escrita al revés", () => {
    expect(isReadOnly({ readOnlyZones: [{ startCell: "C10", endCell: "B3" }] }, "B5")).toBe(true);
  });

  it("protege entera una celda combinada cuyo origen está protegido", () => {
    const sheet = {
      readOnlyZones: [{ startCell: "B2", endCell: "B2" }],
      mergedCells: [{ startCell: "B2", endCell: "D2" }],
    };
    expect(isReadOnly(sheet, "B2")).toBe(true);
    expect(isReadOnly(sheet, "C2")).toBe(true);
    expect(isReadOnly(sheet, "D2")).toBe(true);
    expect(isReadOnly(sheet, "E2")).toBe(false);
  });

  it("no protege una combinada cuyo origen queda fuera", () => {
    const sheet = {
      readOnlyZones: [{ startCell: "D2", endCell: "D2" }],
      mergedCells: [{ startCell: "B2", endCell: "D2" }],
    };
    // D2 está en la zona por sí misma; C2 no, porque el origen B2 no lo está.
    expect(isReadOnly(sheet, "D2")).toBe(true);
    expect(isReadOnly(sheet, "C2")).toBe(false);
  });

  it("ignora referencias mal formadas", () => {
    expect(isReadOnly({ readOnlyZones: [zona] }, "B-3")).toBe(false);
  });
});
