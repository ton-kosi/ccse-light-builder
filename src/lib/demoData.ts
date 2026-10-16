/**
 * Test data (codes start with "DEMO-") so the LED linear / FO builders, stock and purchases can be
 * tried end to end. Loaded and removed from the SKU page by an admin.
 *
 * Each SKU gets its category + builder fields, a selling price / max discount, and one or two
 * purchases (which receive stock and set the cost to the latest purchase).
 */
import { supabase } from "@/integrations/supabase/client";
import { saveSkuPrice } from "@/lib/skuPrices";
import { writeTags } from "@/lib/skuCategory";

export const DEMO_PREFIX = "DEMO-";
const SUPPLIER = "DEMO supplier";

type Demo = {
  code: string;
  name: string;
  unit: string;
  cat: string;
  attrs?: Record<string, string>;
  sell: number;
  disc: number;
  /** purchases, oldest first: [unit price, qty] */
  buys: [number, number][];
  source?: "domestic" | "import";
};

const led = (code: string, name: string, w: number, chip: "STANDARD" | "NICHIA", pcb: number, sell: number, cost: number, ez = false): Demo => ({
  code: `DEMO-${code}`,
  name,
  unit: "M.",
  cat: "LED ribbon",
  attrs: { "W/m": String(w), ชิป: chip, ปริ้น: String(pcb), "EZ clip": ez ? "ใช่" : "ไม่" },
  sell,
  disc: 15,
  buys: [[Math.round(cost * 0.92), 200], [cost, 300]],
  source: "import",
});
const prf = (model: string, name: string, sell: number, cost: number): Demo => ({
  code: `DEMO-PRF-${model.replace(".", "")}`,
  name,
  unit: "M.",
  cat: "LED profile",
  attrs: { รุ่น: model },
  sell,
  disc: 10,
  buys: [[cost, 100]],
});
const psu = (watt: number, dim: string, sell: number, cost: number): Demo => ({
  code: `DEMO-PSU-${watt}-${dim}`,
  name: `Power supply 24V ${watt}W ${dim}`,
  unit: "EA.",
  cat: "Power supply",
  attrs: { วัตต์: String(watt), ดิม: dim },
  sell,
  disc: 10,
  buys: [[cost, 20]],
});

export const DEMO_SKUS: Demo[] = [
  led("LED-4.5", "LED Strip 4.5W/m 24V 3000K CRI90 120°", 4.5, "STANDARD", 8, 380, 130),
  led("LED-9.4", "LED Strip 9.4W/m 24V 3000K CRI90 120°", 9.4, "STANDARD", 8, 480, 170),
  led("LED-13.8N", "LED Strip 13.8W/m 24V 3000K Nichia 160°", 13.8, "NICHIA", 10, 780, 290),
  led("LED-18", "LED Strip 18W/m 24V 3000K CRI90 120°", 18, "STANDARD", 10, 680, 240),
  led("LED-RGBW", "LED Strip RGBW 19.2W/m 24V", 19.2, "STANDARD", 12, 950, 360),
  led("LED-14.4EZ", "LED Strip 14.4W/m 24V 2700K (EZ clip)", 14.4, "STANDARD", 10, 720, 260, true),
  { code: "DEMO-ALU-38", name: 'Aluminium flat bar 3/8"', unit: "M.", cat: "LED heat sink", attrs: { ราง: "3/8" }, sell: 120, disc: 10, buys: [[38, 200], [42, 200]] },
  { code: "DEMO-ALU-48", name: 'Aluminium flat bar 4/8"', unit: "M.", cat: "LED heat sink", attrs: { ราง: "4/8" }, sell: 150, disc: 10, buys: [[50, 200]] },
  { code: "DEMO-JK-S", name: "Single jacket (ท่อหด)", unit: "M.", cat: "LED jacket", sell: 60, disc: 10, buys: [[15, 300]] },
  { code: "DEMO-JK-D", name: "Double jacket (ท่อหด 2 ชั้น)", unit: "M.", cat: "LED jacket", sell: 110, disc: 10, buys: [[28, 300]] },
  prf("W13.13", "Jedi V2 W13.13 profile + diffuser", 450, 170),
  prf("W13.20", "Jedi V2 W13.20 profile + diffuser", 550, 200),
  prf("W13.25", "Jedi V2 W13.25 profile + diffuser", 650, 240),
  prf("W22.13", "Jedi V2 W22.13 profile + diffuser", 650, 240),
  prf("W22.20", "Jedi V2 W22.20 profile + diffuser", 750, 280),
  prf("W22.25", "Jedi V2 W22.25 profile + diffuser", 850, 320),
  prf("45R", "45° Reverse profile + diffuser", 600, 220),
  { code: "DEMO-CLIP", name: "Mounting clip สำหรับ profile", unit: "EA.", cat: "LED accessory", sell: 15, disc: 0, buys: [[4, 500]] },
  { code: "DEMO-PAINT", name: "Industrial spray painting (ต่อเมตร)", unit: "M.", cat: "Service", sell: 250, disc: 0, buys: [] },
  psu(60, "NON-DIM", 950, 380),
  psu(100, "NON-DIM", 1300, 520),
  psu(150, "NON-DIM", 1700, 680),
  psu(75, "DALI", 2600, 1100),
  psu(150, "DALI", 3800, 1600),
  psu(100, "0-10V", 2200, 900),
  psu(100, "DMX", 3200, 1350),
  { code: "DEMO-CLP-308T-3.4", name: "Clipso fabric 308T 3.4m", unit: "ตร.ม.", cat: "Clipso fabric", attrs: { รุ่นผ้า: "308T", หน้าผ้า: "3.4", ยาวม้วน: "50" }, sell: 1500, disc: 10, buys: [[480, 170], [520, 170]], source: "import" },
  { code: "DEMO-CLP-308T-5.1", name: "Clipso fabric 308T 5.1m", unit: "ตร.ม.", cat: "Clipso fabric", attrs: { รุ่นผ้า: "308T", หน้าผ้า: "5.1", ยาวม้วน: "50" }, sell: 1650, disc: 10, buys: [[600, 255]], source: "import" },
  { code: "DEMO-CLP-495D-3.4", name: "Clipso fabric 495D acoustic 3.4m", unit: "ตร.ม.", cat: "Clipso fabric", attrs: { รุ่นผ้า: "495D ACOUSTIC", หน้าผ้า: "3.4", ยาวม้วน: "50" }, sell: 1900, disc: 10, buys: [[700, 170]], source: "import" },
  { code: "DEMO-TRK-CC", name: "Clipso track CC 2m", unit: "เส้น", cat: "Clipso track", attrs: { ราง: "CC", ยาวเส้น: "2" }, sell: 450, disc: 5, buys: [[140, 200]], source: "import" },
  { code: "DEMO-TRK-CW", name: "Clipso track CW 2m", unit: "เส้น", cat: "Clipso track", attrs: { ราง: "CW", ยาวเส้น: "2" }, sell: 420, disc: 5, buys: [[130, 200]], source: "import" },
  { code: "DEMO-MISC", name: "Miscellaneous ไฟใต้ผ้า (สาย ขายึด) ต่อชุด", unit: "ชุด", cat: "LED accessory", sell: 1500, disc: 0, buys: [[400, 20]] },
  { code: "DEMO-FO50W", name: "FO illuminator 50W Halogen", unit: "EA.", cat: "FO illuminator", sell: 25000, disc: 15, buys: [[9500, 4], [10000, 4]], source: "import" },
  { code: "DEMO-FOC-0.75", name: "FO cable 0.75mm", unit: "M.", cat: "FO cable", sell: 35, disc: 10, buys: [[9, 2000]], source: "import" },
  { code: "DEMO-FOC-1.0", name: "FO cable 1.00mm", unit: "M.", cat: "FO cable", sell: 55, disc: 10, buys: [[14, 2000]], source: "import" },
  { code: "DEMO-FOC-1.5", name: "FO cable 1.50mm", unit: "M.", cat: "FO cable", sell: 90, disc: 10, buys: [[24, 1000]], source: "import" },
  { code: "DEMO-FO-END", name: "FO End Finishing", unit: "EA.", cat: "FO accessory", sell: 20, disc: 10, buys: [[5, 3000]] },
  { code: "DEMO-FO-HARNESS", name: "FO Harness 50W", unit: "EA.", cat: "FO accessory", sell: 3500, disc: 10, buys: [[1200, 10]] },
  { code: "DEMO-FO-PORT", name: "FO standard Optical Port 50W", unit: "EA.", cat: "FO accessory", sell: 2500, disc: 10, buys: [[800, 10]] },
  { code: "DEMO-FO-WP50", name: "FO WP box 50W", unit: "EA.", cat: "FO accessory", sell: 4500, disc: 10, buys: [[1500, 6]] },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString("sv-SE");

/** Adds / refreshes the DEMO SKUs, their prices and purchases. Safe to run again. */
export async function loadDemoData(progress: (msg: string) => void): Promise<number> {
  const { data: existing, error: e0 } = await supabase.from("skus").select("id, code").like("code", `${DEMO_PREFIX}%`);
  if (e0) throw e0;
  const had = new Set(existing.map((s) => s.code));

  progress("สร้าง SKU…");
  const { data: rows, error } = await supabase
    .from("skus")
    .upsert(
      DEMO_SKUS.map((d) => ({
        code: d.code,
        name: d.name,
        unit: d.unit,
        source: d.source ?? "domestic",
        notes: writeTags("ข้อมูลทดสอบ", { ...(d.attrs ?? {}), หมวด: d.cat }),
      })),
      { onConflict: "code" },
    )
    .select("id, code, name, unit");
  if (error) throw error;
  const byCode = new Map(rows.map((r) => [r.code, r]));

  let i = 0;
  for (const d of DEMO_SKUS) {
    const sku = byCode.get(d.code)!;
    progress(`ตั้งราคา ${++i}/${DEMO_SKUS.length}: ${d.code}`);
    await saveSkuPrice(sku, d.sell, d.disc);
    // purchases only the first time, so running again doesn't double the stock
    if (had.has(d.code)) continue;
    for (const [j, [price, qty]] of d.buys.entries()) {
      const { error: pe } = await supabase.from("purchases").insert({
        sku_id: sku.id,
        qty,
        unit_price: price,
        date: daysAgo((d.buys.length - j) * 30),
        supplier: SUPPLIER,
        doc_no: `DEMO-${String(j + 1).padStart(3, "0")}`,
        note: "ข้อมูลทดสอบ",
      });
      if (pe) throw new Error(`${d.code}: ${pe.message}`);
    }
  }
  return DEMO_SKUS.length;
}

/** Removes the DEMO data again (purchases → price components → SKUs). */
export async function removeDemoData(progress: (msg: string) => void): Promise<void> {
  const { data: skus, error } = await supabase.from("skus").select("id, code").like("code", `${DEMO_PREFIX}%`);
  if (error) throw error;
  if (!skus.length) return;
  const ids = skus.map((s) => s.id);
  progress("ลบประวัติซื้อ…");
  const d1 = await supabase.from("purchases").delete().in("sku_id", ids);
  if (d1.error) throw d1.error;
  progress("ลบราคาขาย…");
  const { data: comps } = await supabase.from("sales_components").select("id").like("code", `P-${DEMO_PREFIX}%`);
  const compIds = (comps ?? []).map((c) => c.id);
  if (compIds.length) {
    await supabase.from("component_prices").delete().in("component_id", compIds);
    await supabase.from("recipes").delete().in("component_id", compIds);
    await supabase.from("component_clauses").delete().in("component_id", compIds);
    const d2 = await supabase.from("sales_components").delete().in("id", compIds);
    if (d2.error) throw d2.error;
  }
  progress("ลบ SKU…");
  const d3 = await supabase.from("skus").delete().in("id", ids);
  if (d3.error)
    throw new Error(`ลบ SKU ทดสอบไม่ได้ทั้งหมด (อาจถูกใช้ในใบเสนอราคาอยู่): ${d3.error.message}`);
}
