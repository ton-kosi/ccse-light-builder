/**
 * The two companies that issue quotations and bills: CCSE (บริษัท ชิงชัยและบุตรวิศวกรรม) and
 * One Engineering (บริษัท วรรณวิศวกรรม). Stored in `public.companies` (editable in ตั้งค่า);
 * the built-in copy below is only used until that table exists.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Company = Tables<"companies">;

const base = {
  address_th: null,
  bank_name_en: "Bangkok Bank",
  bank_branch_en: "Thong lor rd. branch",
  bank_name_th: "ธนาคารกรุงเทพ",
  bank_branch_th: "ถนนทองหล่อ",
  signer_name: "ATCH KOSIYABONG",
  signer_title: "MANAGING DIRECTOR",
  logo_data: null,
  updated_at: "",
};

export const BUILT_IN_COMPANIES: Company[] = [
  {
    ...base,
    id: "ccse",
    name_th: "บริษัท ชิงชัยและบุตรวิศวกรรม จำกัด",
    name_en: "CHINGCHAI & SONS ENGINEERING COMPANY LIMITED",
    short_en: "CHINGCHAI & SONS ENGINEERING CO., LTD.",
    tax_id: "0105527021885",
    address_th:
      "เลขที่ 213 ซอยเจริญมิตร ถนนสุขุมวิท 63 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110",
    address_en:
      "213 SOI CHAROENMIT, SUKUMVIT 63 ROAD, KLONGTON(NORTH), WATTANA, BANGKOK 10110 THAILAND",
    contact_line: "T : 02-392-2200 (AUTOMATIC 6 LINES)  F : 02-392-6966  WWW.CCSE-GROUP.COM",
    bank_account_name_en: "Chingchai & Sons Engineering Co., Ltd.",
    bank_account_name_th: "บริษัท ชิงชัยและบุตรวิศวกรรม จำกัด",
    bank_account_no: "206 3 003863",
    default_wht_percent: 0,
    quote_prefix: "QC",
    sort_order: 1,
  },
  {
    ...base,
    id: "one",
    name_th: "บริษัท วรรณวิศวกรรม จำกัด",
    name_en: "ONE ENGINEERING COMPANY LIMITED",
    short_en: "ONE ENGINEERING CO., LTD.",
    tax_id: "0105538071005",
    address_en:
      "213 Soi Chareonmit Sukhumvit 63 Road, Klongton (North), Wattana, Bangkok 10110, Thailand",
    contact_line: "Tel. 662.392.2200  Fax 662.392.6966",
    bank_account_name_en: "One Engineering Co., Ltd.",
    bank_account_name_th: "บริษัท วรรณ วิศวกรรม จำกัด",
    bank_account_no: "206 3 035014",
    default_wht_percent: 3,
    quote_prefix: "QO",
    sort_order: 2,
  },
];

export const COMPANIES_KEY = ["companies"];

export function useCompanies() {
  const { data } = useQuery({
    queryKey: COMPANIES_KEY,
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await supabase.from("companies").select("*").order("sort_order");
      // table not created yet → built-in copy
      if (error || !data?.length) return BUILT_IN_COMPANIES;
      return data;
    },
    staleTime: 5 * 60_000,
  });
  return data ?? BUILT_IN_COMPANIES;
}

export function companyOf(list: Company[], id: string | null | undefined): Company {
  return (
    list.find((c) => c.id === id) ??
    list.find((c) => c.id === "ccse") ??
    list[0] ??
    BUILT_IN_COMPANIES[0]!
  );
}

/** "สำนักงานใหญ่" when no branch is given (customers with a tax id). */
export const branchText = (branch: string | null | undefined) => branch?.trim() || "สำนักงานใหญ่";
