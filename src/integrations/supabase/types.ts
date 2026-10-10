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
      billing_counters: {
        Row: {
          last_no: number
          year: number
        }
        Insert: {
          last_no?: number
          year: number
        }
        Update: {
          last_no?: number
          year?: number
        }
        Relationships: []
      }
      billing_docs: {
        Row: {
          amount: number
          attn: string | null
          bill_date: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          credit_days: number
          customer_address: string | null
          customer_name: string | null
          description: string
          doc_no: string
          due_date: string | null
          grand_total: number
          id: string
          pdf_path: string | null
          po_number: string | null
          project_id: string
          project_name: string | null
          quotation_id: string
          quotation_ref: string | null
          quotation_rev: string | null
          term_id: string
          vat_amount: number
          vat_percent: number
        }
        Insert: {
          amount: number
          attn?: string | null
          bill_date: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          credit_days?: number
          customer_address?: string | null
          customer_name?: string | null
          description: string
          doc_no: string
          due_date?: string | null
          grand_total: number
          id?: string
          pdf_path?: string | null
          po_number?: string | null
          project_id: string
          project_name?: string | null
          quotation_id: string
          quotation_ref?: string | null
          quotation_rev?: string | null
          term_id: string
          vat_amount: number
          vat_percent?: number
        }
        Update: {
          amount?: number
          attn?: string | null
          bill_date?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          credit_days?: number
          customer_address?: string | null
          customer_name?: string | null
          description?: string
          doc_no?: string
          due_date?: string | null
          grand_total?: number
          id?: string
          pdf_path?: string | null
          po_number?: string | null
          project_id?: string
          project_name?: string | null
          quotation_id?: string
          quotation_ref?: string | null
          quotation_rev?: string | null
          term_id?: string
          vat_amount?: number
          vat_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_docs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_docs_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_docs_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      component_clauses: {
        Row: {
          clause_id: string
          component_id: string
        }
        Insert: {
          clause_id: string
          component_id: string
        }
        Update: {
          clause_id?: string
          component_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "component_clauses_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "quote_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_clauses_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "sales_components"
            referencedColumns: ["id"]
          },
        ]
      }
      component_prices: {
        Row: {
          component_id: string
          list_price: number | null
          max_discount_percent: number
          updated_at: string
        }
        Insert: {
          component_id: string
          list_price?: number | null
          max_discount_percent?: number
          updated_at?: string
        }
        Update: {
          component_id?: string
          list_price?: number | null
          max_discount_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "component_prices_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: true
            referencedRelation: "sales_components"
            referencedColumns: ["id"]
          },
        ]
      }
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
          qty: number
          quote_line_id: string
          sku_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          qty?: number
          quote_line_id: string
          sku_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          qty?: number
          quote_line_id?: string
          sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_recipes_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_recipes_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
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
      material_issues: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          project_id: string
          quotation_id: string
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          project_id: string
          quotation_id: string
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          project_id?: string
          quotation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_issues_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          data: Json | null
          entity: string
          entity_id: string
          id: string
          term_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          data?: Json | null
          entity: string
          entity_id: string
          id?: string
          term_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          data?: Json | null
          entity?: string
          entity_id?: string
          id?: string
          term_id?: string | null
        }
        Relationships: []
      }
      payment_billings: {
        Row: {
          bill_date: string
          bill_no: string
          created_at: string
          created_by: string | null
          credit_days: number
          due_date: string | null
          id: string
          term_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bill_date: string
          bill_no: string
          created_at?: string
          created_by?: string | null
          credit_days?: number
          due_date?: string | null
          id?: string
          term_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bill_date?: string
          bill_no?: string
          created_at?: string
          created_by?: string | null
          credit_days?: number
          due_date?: string | null
          id?: string
          term_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_billings_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: true
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          amount: number
          bank_ref: string | null
          created_at: string
          created_by: string | null
          id: string
          method: string
          note: string | null
          received_date: string
          slip_path: string | null
          term_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wht_amount: number
        }
        Insert: {
          amount: number
          bank_ref?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method: string
          note?: string | null
          received_date: string
          slip_path?: string | null
          term_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wht_amount?: number
        }
        Update: {
          amount?: number
          bank_ref?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          received_date?: string
          slip_path?: string | null
          term_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wht_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "payment_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_terms: {
        Row: {
          created_at: string
          fixed_amount: number | null
          id: string
          name: string
          note: string | null
          percent: number
          print_label: string | null
          quotation_id: string
          received: boolean
          received_date: string | null
          seq: number
          trigger: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixed_amount?: number | null
          id?: string
          name: string
          note?: string | null
          percent?: number
          print_label?: string | null
          quotation_id: string
          received?: boolean
          received_date?: string | null
          seq?: number
          trigger?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixed_amount?: number | null
          id?: string
          name?: string
          note?: string | null
          percent?: number
          print_label?: string | null
          quotation_id?: string
          received?: boolean
          received_date?: string | null
          seq?: number
          trigger?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_terms_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
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
      project_finance: {
        Row: {
          overrun_rate_per_day: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          overrun_rate_per_day?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          overrun_rate_per_day?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_finance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_status_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: number | null
          id: string
          project_id: string
          to_status: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: number | null
          id?: string
          project_id: string
          to_status: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: number | null
          id?: string
          project_id?: string
          to_status?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_status_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          attn: string | null
          code: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          install_days_actual: number | null
          install_days_max: number | null
          install_days_min: number | null
          install_start_date: string | null
          name: string
          notes: string | null
          po_date: string | null
          po_number: string | null
          released_by: string | null
          selected_option: string | null
          site_address: string | null
          status: number
          updated_at: string
        }
        Insert: {
          attn?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          install_days_actual?: number | null
          install_days_max?: number | null
          install_days_min?: number | null
          install_start_date?: string | null
          name: string
          notes?: string | null
          po_date?: string | null
          po_number?: string | null
          released_by?: string | null
          selected_option?: string | null
          site_address?: string | null
          status?: number
          updated_at?: string
        }
        Update: {
          attn?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          install_days_actual?: number | null
          install_days_max?: number | null
          install_days_min?: number | null
          install_start_date?: string | null
          name?: string
          notes?: string | null
          po_date?: string | null
          po_number?: string | null
          released_by?: string | null
          selected_option?: string | null
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
      purchase_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          date: string
          id: string
          kind: string
          note: string | null
          ordered_at: string | null
          project_id: string | null
          qty: number
          received_at: string | null
          sku_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          kind: string
          note?: string | null
          ordered_at?: string | null
          project_id?: string | null
          qty: number
          received_at?: string | null
          sku_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          kind?: string
          note?: string | null
          ordered_at?: string | null
          project_id?: string | null
          qty?: number
          received_at?: string | null
          sku_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "purchase_requests_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          doc_no: string | null
          extra_cost: number
          id: string
          note: string | null
          project_id: string | null
          purchase_request_id: string | null
          qty: number
          sku_id: string
          supplier: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date?: string
          doc_no?: string | null
          extra_cost?: number
          id?: string
          note?: string | null
          project_id?: string | null
          purchase_request_id?: string | null
          qty: number
          sku_id: string
          supplier?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          doc_no?: string | null
          extra_cost?: number
          id?: string
          note?: string | null
          project_id?: string | null
          purchase_request_id?: string | null
          qty?: number
          sku_id?: string
          supplier?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "purchases_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_clauses: {
        Row: {
          clause_id: string | null
          created_at: string
          edited: boolean
          id: string
          included: boolean
          is_new: boolean
          quotation_id: string
          section: string
          sort_order: number
          text: string
        }
        Insert: {
          clause_id?: string | null
          created_at?: string
          edited?: boolean
          id?: string
          included?: boolean
          is_new?: boolean
          quotation_id: string
          section: string
          sort_order?: number
          text: string
        }
        Update: {
          clause_id?: string | null
          created_at?: string
          edited?: boolean
          id?: string
          included?: boolean
          is_new?: boolean
          quotation_id?: string
          section?: string
          sort_order?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotation_clauses_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "quote_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_clauses_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          closing_text: string | null
          created_at: string
          date: string
          delivery_text: string | null
          discount: number
          id: string
          is_current: boolean
          notes: string | null
          project_id: string
          ref_no: string
          rev: string
          signer_name: string | null
          signer_position: string | null
          signer_user_id: string | null
          updated_at: string
          validity_days: number | null
          vat_percent: number
        }
        Insert: {
          closing_text?: string | null
          created_at?: string
          date?: string
          delivery_text?: string | null
          discount?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          project_id: string
          ref_no: string
          rev?: string
          signer_name?: string | null
          signer_position?: string | null
          signer_user_id?: string | null
          updated_at?: string
          validity_days?: number | null
          vat_percent?: number
        }
        Update: {
          closing_text?: string | null
          created_at?: string
          date?: string
          delivery_text?: string | null
          discount?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          project_id?: string
          ref_no?: string
          rev?: string
          signer_name?: string | null
          signer_position?: string | null
          signer_user_id?: string | null
          updated_at?: string
          validity_days?: number | null
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
      quote_clauses: {
        Row: {
          active: boolean
          always_include: boolean
          created_at: string
          id: string
          section: string
          sort_order: number
          text: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          always_include?: boolean
          created_at?: string
          id?: string
          section: string
          sort_order?: number
          text: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          always_include?: boolean
          created_at?: string
          id?: string
          section?: string
          sort_order?: number
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_lines: {
        Row: {
          circuit_note: string | null
          component_id: string | null
          created_at: string
          customer_text: string | null
          cut_lengths: number[] | null
          discount_percent: number
          id: string
          item_no: string | null
          kind: string
          option_name: string | null
          qty: number | null
          quotation_id: string
          sort_order: number
          unit: string | null
          unit_price: number | null
          updated_at: string
          zone: string | null
        }
        Insert: {
          circuit_note?: string | null
          component_id?: string | null
          created_at?: string
          customer_text?: string | null
          cut_lengths?: number[] | null
          discount_percent?: number
          id?: string
          item_no?: string | null
          kind?: string
          option_name?: string | null
          qty?: number | null
          quotation_id: string
          sort_order?: number
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          zone?: string | null
        }
        Update: {
          circuit_note?: string | null
          component_id?: string | null
          created_at?: string
          customer_text?: string | null
          cut_lengths?: number[] | null
          discount_percent?: number
          id?: string
          item_no?: string | null
          kind?: string
          option_name?: string | null
          qty?: number | null
          quotation_id?: string
          sort_order?: number
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "sales_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          component_id: string
          created_at: string
          id: string
          qty_per_unit: number
          sku_id: string
          updated_at: string
        }
        Insert: {
          component_id: string
          created_at?: string
          id?: string
          qty_per_unit?: number
          sku_id: string
          updated_at?: string
        }
        Update: {
          component_id?: string
          created_at?: string
          id?: string
          qty_per_unit?: number
          sku_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "sales_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "recipes_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      remnants: {
        Row: {
          code: string
          created_at: string
          id: string
          length_m: number
          note: string | null
          reserved_project_id: string | null
          sku_id: string
          source_project_id: string | null
          status: string
          used_at: string | null
          used_m: number | null
          used_project_id: string | null
        }
        Insert: {
          code?: string
          created_at?: string
          id?: string
          length_m: number
          note?: string | null
          reserved_project_id?: string | null
          sku_id: string
          source_project_id?: string | null
          status?: string
          used_at?: string | null
          used_m?: number | null
          used_project_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          length_m?: number
          note?: string | null
          reserved_project_id?: string | null
          sku_id?: string
          source_project_id?: string | null
          status?: string
          used_at?: string | null
          used_m?: number | null
          used_project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remnants_reserved_project_id_fkey"
            columns: ["reserved_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remnants_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "remnants_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remnants_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remnants_used_project_id_fkey"
            columns: ["used_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      roll_plans: {
        Row: {
          created_at: string
          id: string
          leftover_m: number
          pieces: number[]
          project_id: string
          remnant_id: string | null
          roll_family: string
          roll_length_m: number
          seq: number
          sku_id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          leftover_m?: number
          pieces?: number[]
          project_id: string
          remnant_id?: string | null
          roll_family: string
          roll_length_m: number
          seq: number
          sku_id: string
          source: string
        }
        Update: {
          created_at?: string
          id?: string
          leftover_m?: number
          pieces?: number[]
          project_id?: string
          remnant_id?: string | null
          roll_family?: string
          roll_length_m?: number
          seq?: number
          sku_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "roll_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roll_plans_remnant_id_fkey"
            columns: ["remnant_id"]
            isOneToOne: false
            referencedRelation: "remnants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roll_plans_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "roll_plans_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_components: {
        Row: {
          code: string
          created_at: string
          id: string
          install_category: string | null
          is_roll_product: boolean
          name: string
          notes: string | null
          roll_family: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          install_category?: string | null
          is_roll_product?: boolean
          name: string
          notes?: string | null
          roll_family?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          install_category?: string | null
          is_roll_product?: boolean
          name?: string
          notes?: string | null
          roll_family?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          bank_account_name: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_name: string | null
          created_at: string
          id: boolean
          min_remnant_m: number
          updated_at: string
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          created_at?: string
          id?: boolean
          min_remnant_m?: number
          updated_at?: string
        }
        Update: {
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          created_at?: string
          id?: boolean
          min_remnant_m?: number
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
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
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
          code: string
          created_at: string
          cut_step_cm: number | null
          id: string
          is_roll: boolean
          lead_time_days: number
          max_piece_m: number | null
          min_stock: number
          name: string
          notes: string | null
          roll_family: string | null
          roll_length_m: number | null
          source: string
          unit: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          cut_step_cm?: number | null
          id?: string
          is_roll?: boolean
          lead_time_days?: number
          max_piece_m?: number | null
          min_stock?: number
          name: string
          notes?: string | null
          roll_family?: string | null
          roll_length_m?: number | null
          source?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          cut_step_cm?: number | null
          id?: string
          is_roll?: boolean
          lead_time_days?: number
          max_piece_m?: number | null
          min_stock?: number
          name?: string
          notes?: string | null
          roll_family?: string | null
          roll_length_m?: number | null
          source?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          project_id: string | null
          qty: number
          sku_id: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          project_id?: string | null
          qty: number
          sku_id: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          project_id?: string | null
          qty?: number
          sku_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "stock_movements_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "sku_on_hand"
            referencedColumns: ["sku_id"]
          },
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
      sku_on_hand: {
        Row: {
          on_hand: number | null
          sku_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cancel_billing_doc: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      confirm_material_issue: {
        Args: { _project_id: string }
        Returns: undefined
      }
      create_quotation_revision: {
        Args: { _project_id: string }
        Returns: string
      }
      customer_names: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      issue_billing_doc: {
        Args: { _bill_date: string; _credit_days: number; _term_id: string }
        Returns: string
      }
      material_demand: {
        Args: never
        Returns: {
          project_id: string
          project_status: number
          qty: number
          sku_id: string
        }[]
      }
      payment_quote: {
        Args: { _project_id?: string }
        Returns: {
          net_total: number
          quotation_id: string
          ref_no: string
          rev: string
        }[]
      }
      payment_schedule: {
        Args: { _project_id?: string }
        Returns: {
          amount: number
          bill_date: string
          bill_id: string
          bill_no: string
          credit_days: number
          days_overdue: number
          due_date: string
          due_since: string
          due_status: string
          fixed_amount: number
          id: string
          last_received_date: string
          name: string
          net_total: number
          note: string
          outstanding: number
          percent: number
          project_code: string
          project_id: string
          project_name: string
          project_status: number
          quotation_id: string
          received: boolean
          received_date: string
          received_total: number
          ref_no: string
          rev: string
          seq: number
          trigger: string
          wht_total: number
        }[]
      }
      plan_rolls: { Args: { _project_id: string }; Returns: undefined }
      refresh_sku_cost_from_purchases: {
        Args: { _sku: string }
        Returns: undefined
      }
      sync_quotation_clauses: { Args: { _qid: string }; Returns: undefined }
      user_display_names: {
        Args: { _ids: string[] }
        Returns: {
          display_name: string
          id: string
        }[]
      }
      void_receipt: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      wo_header: {
        Args: { _project_id: string }
        Returns: {
          issued_at: string
          quotation_id: string
          ref_no: string
          rev: string
        }[]
      }
      wo_lines: {
        Args: { _project_id: string }
        Returns: {
          circuit_note: string
          component_code: string
          component_name: string
          cut_lengths: number[]
          heading_text: string
          id: string
          install_category: string
          item_no: string
          kind: string
          option_name: string
          qty: number
          sort_order: number
          unit: string
          zone: string
        }[]
      }
      wo_pick_list: {
        Args: { _project_id: string }
        Returns: {
          code: string
          name: string
          on_hand: number
          qty: number
          sku_id: string
          unit: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "sales"
        | "production"
        | "technician"
        | "estimator"
        | "stock"
        | "accounting"
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
      app_role: [
        "admin",
        "sales",
        "production",
        "technician",
        "estimator",
        "stock",
        "accounting",
      ],
    },
  },
} as const
