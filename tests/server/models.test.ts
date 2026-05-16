import { describe, expect, it } from "vitest";
import { parseCreditValueToCent, splitCreditTypes, validateCreditType } from "../../server/domain/models";

describe("domain models", () => {
  it("parses credit values as cents", () => {
    expect(parseCreditValueToCent("0.20")).toBe(20);
    expect(parseCreditValueToCent("1")).toBe(100);
    expect(parseCreditValueToCent("1.05")).toBe(105);
  });

  it("rejects finer than 0.01", () => {
    expect(() => parseCreditValueToCent("0.205")).toThrow("0.01");
  });

  it("splits and validates credit types", () => {
    expect(splitCreditTypes("劳动教育学分，美育实践学分")).toEqual(["劳动教育学分", "美育实践学分"]);
    expect(validateCreditType("美育实践学分")).toBe("美育实践学分");
    expect(() => validateCreditType("志愿服务学分")).toThrow("不支持");
  });
});
