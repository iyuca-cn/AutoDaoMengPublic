import * as XLSX from "xlsx";
import {
  type ImportedDemandRow,
  type ImportBatchDraft,
  type ImportError,
  type PriorityDemandRecord,
  normalizeText,
  parseCreditValueToCent,
  splitCreditTypes,
  validateCreditType,
} from "./models";

const REQUIRED_HEADERS = ["学号", "姓名", "学分类型", "学分数值"] as const;

export function parseImportWorkbook(input: ArrayBuffer | Uint8Array | Buffer | string): ImportBatchDraft {
  const workbook = typeof input === "string"
    ? XLSX.readFile(input, { cellDates: false })
    : XLSX.read(input, { type: "array", cellDates: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) {
    throw new Error("xlsx 中没有可读取的工作表");
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: false,
    raw: false,
  });
  if (rows.length === 0) {
    throw new Error("xlsx 为空");
  }

  const headerRow = rows[0].map((cell) => normalizeText(cell));
  const headerMap = mapHeaders(headerRow);
  const parsedRows: ImportedDemandRow[] = [];
  const errors: ImportError[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const cells = row as unknown[];
    if (isBlankRow(cells)) {
      return;
    }
    const studentId = normalizeText(cells[headerMap["学号"]]);
    const studentName = normalizeText(cells[headerMap["姓名"]]);
    const creditTypeText = normalizeText(cells[headerMap["学分类型"]]);
    const rawValue = cells[headerMap["学分数值"]];
    const creditTypes = splitCreditTypes(creditTypeText);
    let requestedValueCent: number | null = null;

    if (!studentId) {
      errors.push({ rowNumber, field: "学号", message: "学号不能为空" });
    }
    if (!studentName) {
      errors.push({ rowNumber, field: "姓名", message: "姓名不能为空" });
    }
    if (creditTypes.length === 0) {
      errors.push({ rowNumber, field: "学分类型", message: "学分类型不能为空" });
    }
    for (const creditType of creditTypes) {
      try {
        validateCreditType(creditType);
      } catch (error) {
        errors.push({
          rowNumber,
          field: "学分类型",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      requestedValueCent = parseCreditValueToCent(rawValue);
    } catch (error) {
      errors.push({
        rowNumber,
        field: "学分数值",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    parsedRows.push({
      rowNumber,
      studentId,
      studentName,
      creditTypes,
      requestedValueCent,
      enabled: true,
    });
  });

  return {
    rows: parsedRows,
    aggregatedDemands: aggregatePriorityDemands(parsedRows),
    errors,
  };
}

export function aggregatePriorityDemands(rows: ImportedDemandRow[]): PriorityDemandRecord[] {
  const valuesByKey = new Map<string, PriorityDemandRecord>();
  for (const row of rows) {
    if (!row.enabled || row.requestedValueCent === null || !row.studentId || !row.studentName || row.creditTypes.length === 0) {
      continue;
    }
    let validatedCreditTypes: ReturnType<typeof validateCreditType>[];
    try {
      validatedCreditTypes = row.creditTypes.map(validateCreditType);
    } catch {
      continue;
    }
    const key = JSON.stringify([row.studentId, row.studentName, validatedCreditTypes]);
    const existing = valuesByKey.get(key);
    if (existing) {
      existing.requestedValueCent += row.requestedValueCent;
    } else {
      valuesByKey.set(key, {
        studentId: row.studentId,
        studentName: row.studentName,
        creditTypes: validatedCreditTypes,
        requestedValueCent: row.requestedValueCent,
        enabled: true,
      });
    }
  }
  return [...valuesByKey.values()].sort((left, right) => {
    return left.studentId.localeCompare(right.studentId, "zh-CN") || left.creditTypes.join(",").localeCompare(right.creditTypes.join(","), "zh-CN");
  });
}

function mapHeaders(headers: string[]): Record<(typeof REQUIRED_HEADERS)[number], number> {
  const result = {} as Record<(typeof REQUIRED_HEADERS)[number], number>;
  for (const header of REQUIRED_HEADERS) {
    const index = headers.indexOf(header);
    if (index === -1) {
      throw new Error(`xlsx 缺少必需表头：${header}`);
    }
    result[header] = index;
  }
  return result;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => normalizeText(cell) === "");
}
