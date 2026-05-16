import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseImportWorkbook } from "../../server/domain/excel";

function workbookBuffer(headers: string[], rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseImportWorkbook", () => {
  it("detects required columns in any order", () => {
    const result = parseImportWorkbook(workbookBuffer(["学分数值", "姓名", "学号", "学分类型"], [["0.20", "张三", "20250001", "美育实践学分"]]));
    expect(result.rows[0]).toMatchObject({
      studentId: "20250001",
      studentName: "张三",
      creditTypes: ["美育实践学分"],
      requestedValueCent: 20,
    });
  });

  it("splits priority types and aggregates duplicate rows", () => {
    const result = parseImportWorkbook(workbookBuffer(["姓名", "学号", "学分类型", "学分数值"], [
      ["张三", "20250001", "劳动教育学分，美育实践学分", "0.20"],
      ["张三", "20250001", "劳动教育学分，美育实践学分", "0.30"],
      [null, null, null, null],
    ]));
    expect(result.aggregatedDemands).toEqual([
      {
        studentId: "20250001",
        studentName: "张三",
        creditTypes: ["劳动教育学分", "美育实践学分"],
        requestedValueCent: 50,
        enabled: true,
      },
    ]);
  });

  it("returns row-level errors", () => {
    const result = parseImportWorkbook(workbookBuffer(["姓名", "学号", "学分类型", "学分数值"], [["", "20250001", "志愿服务学分", "0.205"]]));
    expect(result.errors.map((error) => error.field)).toEqual(["姓名", "学分类型", "学分数值"]);
  });
});
