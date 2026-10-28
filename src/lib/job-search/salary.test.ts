import { describe, expect, it } from "vitest";

import { meetsFloor, readSalary, salaryLabel } from "./salary";

const read = (salary: string, description = "") => readSalary({ salary, description });

describe("readSalary", () => {
  it.each([
    ["₹40-60 LPA", 40, 60],
    ["INR 30,00,000 – 45,00,000 a year", 30, 45],
    ["INR 4,000,000–6,000,000 a year", 40, 60],
    ["35 Lacs P.A.", 35, 35],
    ["₹1.2 Cr", 120, 120],
    ["₹3,50,000 per month", 42, 42],
  ])("reads %s as %s–%s LPA", (text, min, max) => {
    expect(read(text)).toMatchObject({ status: "stated", currency: "INR", minLpa: min, maxLpa: max });
  });

  it("finds a rupee figure in the description when the source gives none", () => {
    expect(read("", "Great team. CTC: ₹45 - 55 LPA plus ESOPs.")).toMatchObject({ status: "stated", currency: "INR", minLpa: 45, maxLpa: 55 });
  });

  it("keeps another currency as written, without converting it", () => {
    const salary = read("USD 150,000–180,000 a year");
    expect(salary).toMatchObject({ status: "stated", currency: "USD", maxLpa: null });
    expect(meetsFloor(salary, 40)).toBeNull();
    expect(salaryLabel(salary)).toBe("USD 150,000–180,000 a year (stated, not compared)");
  });

  it("marks a source's own prediction as an estimate", () => {
    expect(read("INR 2,500,000 a year (estimated)")).toMatchObject({ status: "estimated", maxLpa: 25 });
  });

  it("says undisclosed, and never infers pay", () => {
    const salary = read("", "We pay competitively, like the best companies.");
    expect(salary.status).toBe("undisclosed");
    expect(meetsFloor(salary, 40)).toBeNull();
    expect(salaryLabel(salary)).toBe("Salary not disclosed");
  });

  it("compares the top of the range with the floor", () => {
    expect(meetsFloor(read("₹30-45 LPA"), 40)).toBe(true);
    expect(meetsFloor(read("₹20-30 LPA"), 40)).toBe(false);
  });
});
