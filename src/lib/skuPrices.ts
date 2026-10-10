import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { partPriceMap } from "@/lib/fo";

/**
 * Selling price + max discount per SKU (admin-set, shown on the SKU page).
 *
 * Stored without a schema change: each priced SKU has a hidden one-SKU sales component
 * (code "P-<sku code>", recipe = 1 × that SKU) whose component_prices row holds the price.
 * Everything else goes through this module, so the storage can later move to a column on skus.
 */
export const SKU_PRICES_KEY = ["sku_prices"] as const;

export const PRICE_COMPONENT_NOTE = "ราคาขายต่อหน่วยของ SKU (ระบบสร้างอัตโนมัติ)";

export function useSkuPrices(enabled = true) {
  return useQuery({
    queryKey: SKU_PRICES_KEY,
    enabled,
    queryFn: async () => {
      const [r, p] = await Promise.all([
        supabase.from("recipes").select("component_id, sku_id, qty_per_unit"),
        supabase.from("component_prices").select("component_id, list_price, max_discount_percent"),
      ]);
      if (r.error) throw r.error;
      if (p.error) throw p.error;
      return partPriceMap(r.data, p.data);
    },
  });
}

/** Finds the one-SKU component that sells this SKU, creating "P-<code>" if there is none. */
export async function ensureSkuComponent(sku: {
  id: string;
  code: string;
  name: string;
  unit: string;
}): Promise<{ componentId: string; perUnit: number }> {
  const { data: uses, error: e1 } = await supabase
    .from("recipes")
    .select("component_id, qty_per_unit")
    .eq("sku_id", sku.id);
  if (e1) throw e1;
  if (uses.length) {
    const { data: all, error: e2 } = await supabase
      .from("recipes")
      .select("component_id")
      .in(
        "component_id",
        uses.map((u) => u.component_id),
      );
    if (e2) throw e2;
    const single = uses.find(
      (u) => all.filter((a) => a.component_id === u.component_id).length === 1,
    );
    if (single)
      return { componentId: single.component_id, perUnit: Number(single.qty_per_unit) || 1 };
  }
  const { data: same } = await supabase
    .from("sales_components")
    .select("code")
    .like("code", `P-${sku.code}%`);
  const code = same?.length ? `P-${sku.code}-${same.length + 1}` : `P-${sku.code}`;
  const { data: comp, error: e3 } = await supabase
    .from("sales_components")
    .insert({ code, name: sku.name, unit: sku.unit, notes: PRICE_COMPONENT_NOTE })
    .select("id")
    .single();
  if (e3) throw e3;
  const { error: e4 } = await supabase
    .from("recipes")
    .insert({ component_id: comp.id, sku_id: sku.id, qty_per_unit: 1 });
  if (e4) throw e4;
  return { componentId: comp.id, perUnit: 1 };
}

/** Admin only (RLS): sets selling price per SKU unit and max discount %. */
export async function saveSkuPrice(
  sku: { id: string; code: string; name: string; unit: string },
  unitPrice: number,
  maxDiscount: number,
) {
  const { componentId, perUnit } = await ensureSkuComponent(sku);
  const { error } = await supabase.from("component_prices").upsert({
    component_id: componentId,
    list_price: Math.round(unitPrice * perUnit * 100) / 100,
    max_discount_percent: Math.min(100, Math.max(0, maxDiscount)),
  });
  if (error) throw error;
}
