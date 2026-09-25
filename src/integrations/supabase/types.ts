export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      customers: {
        Row: {
          address: string | null
          code: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      line_recipes: {
        Row: {
          created_at: string
          id: string
          note: string | null
          qty_per_unit: number
          quotation_line_id: string
          sku_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          qty_per_unit?: number
          quotation_line_id: string
          sku_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          qty_per_unit?: number
          quotation_line_id?: string
          sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_recipes_quotation_line_id_fkey"
            columns: ["quotation_line_id"]
            isOneToOne: false
            referencedRelation: "quotation_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_recipes_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          ceo_approved: boolean
          code: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          deposit_received: boolean
          id: string
          name: string
          notes: string | null
          po_date: string | null
          po_number: string | null
          site_address: string | null
          status: number
          updated_at: string
        }
        Insert: {
          ceo_approved?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deposit_received?: boolean
          id?: string
          name: string
          notes?: string | null
          po_date?: string | null
          po_number?: string | null
          site_address?: string | null
          status?: number
          updated_at?: string
        }
        Update: {
          ceo_approved?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deposit_received?: boolean
          id?: string
          name?: string
          notes?: string | null
          po_date?: string | null
          po_number?: string | null
          site_address?: string | null
          status?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_lines: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_header: boolean
          line_no: number
          qty: number | null
          quotation_id: string
          sales_component_id: string | null
          sales_name: string
          unit: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_header?: boolean
          line_no?: number
          qty?: number | null
          quotation_id: string
          sales_component_id?: string | null
          sales_name: string
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_header?: boolean
          line_no?: number
          qty?: number | null
          quotation_id?: string
          sales_component_id?: string | null
          sales_name?: string
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotation_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_lines_sales_component_id_fkey"
            columns: ["sales_component_id"]
            isOneToOne: false
            referencedRelation: "sales_components"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string
          discount: number
          doc_date: string
          doc_no: string
          id: string
          notes: string | null
          project_id: string
          revision: number
          updated_at: string
          vat_percent: number
        }
        Insert: {
          created_at?: string
          discount?: number
          doc_date?: string
          doc_no: string
          id?: string
          notes?: string | null
          project_id: string
          revision?: number
          updated_at?: string
          vat_percent?: number
        }
        Update: {
          created_at?: string
          discount?: number
          doc_date?: string
          doc_no?: string
          id?: string
          notes?: string | null
          project_id?: string
          revision?: number
          updated_at?: string
          vat_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_items: {
        Row: {
          created_at: string
          id: string
          note: string | null
          qty_per_unit: number
          sales_component_id: string
          sku_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          qty_per_unit?: number
          sales_component_id: string
          sku_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          qty_per_unit?: number
          sales_component_id?: string
          sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_sales_component_id_fkey"
            columns: ["sales_component_id"]
            isOneToOne: false
            referencedRelation: "sales_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_components: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          notes: string | null
          sales_name: string
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          notes?: string | null
          sales_name: string
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          notes?: string | null
          sales_name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      sku_costs: {
        Row: {
          sku_id: string
          supplier: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          sku_id: string
          supplier?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          sku_id?: string
          supplier?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_costs_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: true
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      skus: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          name: string
          notes: string | null
          stock_qty: number
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      work_order_items: {
        Row: {
          created_at: string
          id: string
          issued_qty: number
          item_name: string
          note: string | null
          qty: number
          sku_id: string | null
          unit: string | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          issued_qty?: number
          item_name: string
          note?: string | null
          qty?: number
          sku_id?: string | null
          unit?: string | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          issued_qty?: number
          item_name?: string
          note?: string | null
          qty?: number
          sku_id?: string | null
          unit?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_items_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          created_at: string
          created_by: string | null
          doc_no: string
          id: string
          instructions: string | null
          project_id: string
          released_at: string | null
          released_by: string | null
          scheduled_date: string | null
          status: string
          title: string
          updated_at: string
          wo_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_no: string
          id?: string
          instructions?: string | null
          project_id: string
          released_at?: string | null
          released_by?: string | null
          scheduled_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          wo_type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_no?: string
          id?: string
          instructions?: string | null
          project_id?: string
          released_at?: string | null
          released_by?: string | null
          scheduled_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          wo_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_see_money: { Args: { _user_id: string }; Returns: boolean }
      claim_ceo: { Args: never; Returns: boolean }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "ceo" | "sales" | "production" | "technician"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["ceo", "sales", "production", "technician"],
    },
  },
} as const
