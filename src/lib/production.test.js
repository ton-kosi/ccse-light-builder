import { describe, expect, it } from "bun:test";
import {
  colourFromText,
  exactStep,
  fixtureCode,
  ledCutOptions,
  lineRows,
  lineTotals,
  pieceRow,
  suggestPsu,
  wattFromText,
} from "./production.ts";

describe("LED cut rounding (สรุปความยาว)", () => {
  it("matches the Wynn sheet: 7.2W 30 Nichia cuts every 16.67 cm", () => {
    // 78 cm on site → 66.67 shorter (diff 11.33) / 83.33 longer (diff −5.33), as on the sheet
    expect(ledCutOptions(78, 16.67)).toEqual({ shorter: 66.67, longer: 83.33, diffShorter: 11.33, diffLonger: -5.33 });
    // 300 cm = exactly 18 cuts of 50/3 cm
    expect(ledCutOptions(300, 16.67)).toEqual({ shorter: 300, longer: 300, diffShorter: 0, diffLonger: 0 });
    // 163.6 → 150 / 166.67 (sheet row: diff 13.6 / −3.07)
    expect(ledCutOptions(163.6, 16.67)).toEqual({ shorter: 150, longer: 166.67, diffShorter: 13.6, diffLonger: -3.07 });
  });

  it("uses exact thirds / sixths for rounded steps", () => {
    expect(exactStep(16.67)).toBeCloseTo(50 / 3, 9);
    expect(exactStep(3.33)).toBeCloseTo(10 / 3, 9);
    expect(exactStep(4.16)).toBeCloseTo(25 / 6, 9);
    expect(exactStep(6.25)).toBe(6.25);
    expect(exactStep(10)).toBe(10);
  });

  it("keeps an exact multiple as is and handles no step", () => {
    expect(ledCutOptions(200, 10)).toEqual({ shorter: 200, longer: 200, diffShorter: 0, diffLonger: 0 });
    expect(ledCutOptions(123.4, 0).shorter).toBe(123.4);
  });
});

describe("production row", () => {
  it("follows the workbook: profile −0.4, shrink +2 per piece, clips per 40 cm, amps at 24 V", () => {
    const r = pieceRow({ lengthM: 2, sets: 2, stepCm: 10, wattPerM: 14.4, hasProfile: true, rounding: "down" });
    expect(r).toEqual({
      siteCm: 200,
      sets: 2,
      ledCm: 200,
      profileCm: 199.6,
      diffCm: 0,
      shrinkCm: 404,
      clips: 10,
      amps: 2.4,
      shorter: 200,
      longer: 200,
    });
  });

  it("rounds up when asked and leaves profile empty for a bare strip", () => {
    const r = pieceRow({ lengthM: 0.78, sets: 1, stepCm: 16.67, wattPerM: 7.2, hasProfile: false, rounding: "up" });
    expect(r.ledCm).toBe(83.33);
    expect(r.profileCm).toBe(null);
    expect(r.diffCm).toBe(-5.33);
  });
});

describe("line totals", () => {
  it("adds runs with sets and joined pieces", () => {
    const rows = lineRows(
      [
        { pieces: [2], sets: 22 },
        { pieces: [3, 3.5], sets: 1 },
      ],
      { stepCm: 10, wattPerM: 14.4, hasProfile: false, rounding: "down" },
    );
    expect(rows).toHaveLength(3);
    const t = lineTotals(rows);
    expect(t.pieces).toBe(24);
    expect(t.ledM).toBe(50.5); // 44 + 6.5 m
    expect(t.bars).toBe(9); // 50.5 m / 6 m bars
    expect(t.clips).toBe(22 * 5 + 8 + 9);
    expect(t.amps).toBe(30.3); // 14.4 W/m × 50.5 m ÷ 24 V
  });
});

describe("power supply suggestion", () => {
  it("picks the smallest 24 V supply loaded to at most 80 %", () => {
    expect(suggestPsu(2.4)).toBe(3.2);
    expect(suggestPsu(3.6)).toBe(4.5);
    expect(suggestPsu(26)).toBe(null); // needs splitting into circuits
    expect(suggestPsu(null)).toBe(null);
  });
});

describe("reading the BOQ text", () => {
  it("finds watt, colour and fixture code", () => {
    expect(wattFromText("LX-473.022.1 : LED STRIP 7W/M 24V 2700K")).toBe(7);
    expect(wattFromText("LED strip 14.4W/m")).toBe(14.4);
    expect(colourFromText("LED STRIP 7W/M 24V 2700K")).toBe("2700K");
    expect(colourFromText("JEDI FLEX RGB")).toBe("RGB");
    expect(fixtureCode("LX-473.022.1 : LED STRIP 7W/M")).toBe("LX-473.022.1");
    expect(fixtureCode("UW500 : LED CANOE")).toBe("UW500");
    expect(fixtureCode("FLOOR 1")).toBe(null);
  });
});
