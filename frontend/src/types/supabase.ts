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
      action_entities: {
        Row: {
          action_id: string
          entity_key: string
          entity_type: string
          kept_at: string
          label: string | null
          removed_at: string | null
          removed_reason: string | null
        }
        Insert: {
          action_id: string
          entity_key: string
          entity_type: string
          kept_at?: string
          label?: string | null
          removed_at?: string | null
          removed_reason?: string | null
        }
        Update: {
          action_id?: string
          entity_key?: string
          entity_type?: string
          kept_at?: string
          label?: string | null
          removed_at?: string | null
          removed_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_entities_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_events: {
        Row: {
          action_id: string
          actor_id: string | null
          created_at: string
          data: Json
          event: string
          id: string
        }
        Insert: {
          action_id: string
          actor_id?: string | null
          created_at?: string
          data?: Json
          event: string
          id?: string
        }
        Update: {
          action_id?: string
          actor_id?: string | null
          created_at?: string
          data?: Json
          event?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_events_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      action_signals: {
        Row: {
          action_id: string
          linked_at: string
          signal_id: string
        }
        Insert: {
          action_id: string
          linked_at?: string
          signal_id: string
        }
        Update: {
          action_id?: string
          linked_at?: string
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_signals_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_signals_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      action_task_reviews: {
        Row: {
          action_id: string
          created_at: string
          details: Json
          id: string
          missing: string[]
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          action_id: string
          created_at?: string
          details?: Json
          id?: string
          missing?: string[]
          source?: string
          title: string
          updated_at?: string
        }
        Update: {
          action_id?: string
          created_at?: string
          details?: Json
          id?: string
          missing?: string[]
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_task_reviews_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_tasks: {
        Row: {
          action_id: string
          created_at: string
          depends_on: string[]
          details: Json | null
          id: string
          mode: string
          output: Json | null
          permission: string
          position: number
          skip_reason: string | null
          status: string
          task_key: string | null
          task_version: number
          title: string | null
          title_params: Json
          updated_at: string
        }
        Insert: {
          action_id: string
          created_at?: string
          depends_on?: string[]
          details?: Json | null
          id?: string
          mode?: string
          output?: Json | null
          permission?: string
          position: number
          skip_reason?: string | null
          status?: string
          task_key?: string | null
          task_version?: number
          title?: string | null
          title_params?: Json
          updated_at?: string
        }
        Update: {
          action_id?: string
          created_at?: string
          depends_on?: string[]
          details?: Json | null
          id?: string
          mode?: string
          output?: Json | null
          permission?: string
          position?: number
          skip_reason?: string | null
          status?: string
          task_key?: string | null
          task_version?: number
          title?: string | null
          title_params?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_tasks_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
        ]
      }
      actions: {
        Row: {
          action_no: number
          assignee_id: string | null
          baseline: Json
          brand_id: string
          category: string
          completed_at: string | null
          created_at: string
          dedup_key: string
          dismiss_reason: string | null
          due_date: string | null
          id: string
          impact: string
          kind: string
          kpi_keys: string[]
          outcome: string
          payload: Json
          position_outcome: Json | null
          priority_level: string | null
          priority_reason: Json | null
          priority_score: number | null
          priority_updated_at: string | null
          stale_at: string | null
          status: string
          tasks_generated_at: string | null
          tasks_writing_since: string | null
          updated_at: string
          validated_at: string | null
          validation: Json | null
        }
        Insert: {
          action_no?: never
          assignee_id?: string | null
          baseline?: Json
          brand_id: string
          category: string
          completed_at?: string | null
          created_at?: string
          dedup_key: string
          dismiss_reason?: string | null
          due_date?: string | null
          id?: string
          impact: string
          kind: string
          kpi_keys?: string[]
          outcome?: string
          payload?: Json
          position_outcome?: Json | null
          priority_level?: string | null
          priority_reason?: Json | null
          priority_score?: number | null
          priority_updated_at?: string | null
          stale_at?: string | null
          status?: string
          tasks_generated_at?: string | null
          tasks_writing_since?: string | null
          updated_at?: string
          validated_at?: string | null
          validation?: Json | null
        }
        Update: {
          action_no?: never
          assignee_id?: string | null
          baseline?: Json
          brand_id?: string
          category?: string
          completed_at?: string | null
          created_at?: string
          dedup_key?: string
          dismiss_reason?: string | null
          due_date?: string | null
          id?: string
          impact?: string
          kind?: string
          kpi_keys?: string[]
          outcome?: string
          payload?: Json
          position_outcome?: Json | null
          priority_level?: string | null
          priority_reason?: Json | null
          priority_score?: number | null
          priority_updated_at?: string | null
          stale_at?: string | null
          status?: string
          tasks_generated_at?: string | null
          tasks_writing_since?: string | null
          updated_at?: string
          validated_at?: string | null
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "actions_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      add_on_products: {
        Row: {
          active: boolean
          billing: string
          created_at: string
          currency: string
          grant_ai_usd: number | null
          grant_bytes: number | null
          highlight: boolean
          id: string
          kind: string
          name: string
          price_cents: number
          sort: number
          stripe_price_id: string | null
          updated_at: string
          valid_months: number | null
        }
        Insert: {
          active?: boolean
          billing: string
          created_at?: string
          currency?: string
          grant_ai_usd?: number | null
          grant_bytes?: number | null
          highlight?: boolean
          id: string
          kind: string
          name: string
          price_cents: number
          sort?: number
          stripe_price_id?: string | null
          updated_at?: string
          valid_months?: number | null
        }
        Update: {
          active?: boolean
          billing?: string
          created_at?: string
          currency?: string
          grant_ai_usd?: number | null
          grant_bytes?: number | null
          highlight?: boolean
          id?: string
          kind?: string
          name?: string
          price_cents?: number
          sort?: number
          stripe_price_id?: string | null
          updated_at?: string
          valid_months?: number | null
        }
        Relationships: []
      }
      add_on_purchases: {
        Row: {
          amount_paid_cents: number | null
          bought_by: string | null
          created_at: string
          currency: string
          expires_at: string | null
          granted_at: string | null
          id: string
          organization_id: string
          product_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_invoice_id: string | null
          stripe_subscription_item_id: string | null
          updated_at: string
        }
        Insert: {
          amount_paid_cents?: number | null
          bought_by?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          organization_id: string
          product_id: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_subscription_item_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_paid_cents?: number | null
          bought_by?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          organization_id?: string
          product_id?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_subscription_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "add_on_purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "add_on_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "add_on_products"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          brand_id: string | null
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          completion_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          prompt_tokens: number | null
          role: string
          tool_call_id: string | null
          tool_calls: Json | null
          tool_name: string | null
          tool_result: Json | null
        }
        Insert: {
          completion_tokens?: number | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          prompt_tokens?: number | null
          role: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
        }
        Update: {
          completion_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          prompt_tokens?: number | null
          role?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_token_usage: {
        Row: {
          completion_tokens: number
          created_at: string
          id: string
          organization_id: string
          prompt_tokens: number
          updated_at: string
          user_id: string
          year_month: string
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          id?: string
          organization_id: string
          prompt_tokens?: number
          updated_at?: string
          user_id: string
          year_month: string
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          id?: string
          organization_id?: string
          prompt_tokens?: number
          updated_at?: string
          user_id?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_token_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_grants: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          purchase_id: string
          updated_at: string
          usd_total: number
          usd_used: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          purchase_id: string
          updated_at?: string
          usd_total: number
          usd_used?: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          purchase_id?: string
          updated_at?: string
          usd_total?: number
          usd_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_credit_grants_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: true
            referencedRelation: "add_on_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_traffic_events: {
        Row: {
          brand_id: string
          currency: string | null
          first_at: string
          first_key: string | null
          first_source: string
          first_url: string
          goal: string | null
          id: string
          kind: string
          label: string | null
          occurred_at: string
          order_ref: string | null
          origin: string | null
          page_key: string | null
          units: number | null
          url: string
          value: number | null
          visitor_id: string
        }
        Insert: {
          brand_id: string
          currency?: string | null
          first_at: string
          first_source: string
          first_url: string
          goal?: string | null
          id?: string
          kind: string
          label?: string | null
          occurred_at?: string
          order_ref?: string | null
          origin?: string | null
          units?: number | null
          url: string
          value?: number | null
          visitor_id: string
        }
        Update: {
          brand_id?: string
          currency?: string | null
          first_at?: string
          first_source?: string
          first_url?: string
          goal?: string | null
          id?: string
          kind?: string
          label?: string | null
          occurred_at?: string
          order_ref?: string | null
          origin?: string | null
          units?: number | null
          url?: string
          value?: number | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_traffic_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_traffic_logs: {
        Row: {
          brand_id: string
          country: string | null
          created_at: string
          id: string
          ip_address: string | null
          language: string | null
          referrer: string | null
          screen: string | null
          source_platform: string | null
          url: string
          user_agent: string | null
          visit_of: string | null
        }
        Insert: {
          brand_id: string
          country?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          language?: string | null
          referrer?: string | null
          screen?: string | null
          source_platform?: string | null
          url: string
          user_agent?: string | null
          visit_of?: string | null
        }
        Update: {
          brand_id?: string
          country?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          language?: string | null
          referrer?: string | null
          screen?: string | null
          source_platform?: string | null
          url?: string
          user_agent?: string | null
          visit_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_traffic_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_traffic_logs_visit_of_fkey"
            columns: ["visit_of"]
            isOneToOne: false
            referencedRelation: "ai_traffic_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_signal_results: {
        Row: {
          audit_id: string
          category: string | null
          created_at: string
          evidence: Json
          id: string
          score: number | null
          signal_key: string
          status: string
        }
        Insert: {
          audit_id: string
          category?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          score?: number | null
          signal_key: string
          status: string
        }
        Update: {
          audit_id?: string
          category?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          score?: number | null
          signal_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_signal_results_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "site_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_domains: {
        Row: {
          brand_id: string
          country: string | null
          created_at: string
          domain: string
          id: string
          is_primary: boolean
        }
        Insert: {
          brand_id: string
          country?: string | null
          created_at?: string
          domain: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          brand_id?: string
          country?: string | null
          created_at?: string
          domain?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "brand_domains_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_integrations: {
        Row: {
          account_id: string
          brand_id: string
          created_at: string
          provider: string
          settings: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          brand_id: string
          created_at?: string
          provider: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          brand_id?: string
          created_at?: string
          provider?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_integrations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_integrations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_platforms: {
        Row: {
          api_model: string | null
          brand_id: string
          check_frequency: string
          created_at: string
          id: string
          is_enabled: boolean
          last_checked_at: string | null
          platform: string
          updated_at: string
        }
        Insert: {
          api_model?: string | null
          brand_id: string
          check_frequency?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_checked_at?: string | null
          platform: string
          updated_at?: string
        }
        Update: {
          api_model?: string | null
          brand_id?: string
          check_frequency?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_checked_at?: string | null
          platform?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_platforms_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          brand_rules: string[]
          client_logo_path: string | null
          content_byline: boolean
          content_quality_handoff: boolean
          conversions_consent: string
          conversions_enabled: boolean
          created_at: string
          demo_built_at: string | null
          demo_hidden_at: string | null
          demo_version: number | null
          description: string | null
          ga_property_id: string | null
          gsc_pages_backfill_from: string | null
          gsc_pages_backfilled_property: string | null
          gsc_property: string | null
          gsc_shopping_property: string | null
          gsc_shopping_synced_at: string | null
          id: string
          industry: string | null
          insights_pinned_competitors: string[]
          is_active: boolean
          is_demo: boolean
          kpi_setup_at: string | null
          language: string | null
          logo_url: string | null
          name: string
          openai_product_feed: boolean
          organization_id: string
          region: string | null
          shopping_mode_enabled: boolean
          site_type: string | null
          site_type_detected_at: string | null
          site_type_source: string | null
          slug: string
          snippet_checked_at: string | null
          snippet_found_at: string | null
          state: string | null
          tracking_code: string
          trusted_sources: string[]
          updated_at: string
        }
        Insert: {
          brand_rules?: string[]
          client_logo_path?: string | null
          content_byline?: boolean
          content_quality_handoff?: boolean
          conversions_consent?: string
          conversions_enabled?: boolean
          created_at?: string
          demo_built_at?: string | null
          demo_hidden_at?: string | null
          demo_version?: number | null
          description?: string | null
          ga_property_id?: string | null
          gsc_pages_backfill_from?: string | null
          gsc_pages_backfilled_property?: string | null
          gsc_property?: string | null
          gsc_shopping_property?: string | null
          gsc_shopping_synced_at?: string | null
          id?: string
          industry?: string | null
          insights_pinned_competitors?: string[]
          is_active?: boolean
          is_demo?: boolean
          kpi_setup_at?: string | null
          language?: string | null
          logo_url?: string | null
          name: string
          openai_product_feed?: boolean
          organization_id: string
          region?: string | null
          shopping_mode_enabled?: boolean
          site_type?: string | null
          site_type_detected_at?: string | null
          site_type_source?: string | null
          slug: string
          snippet_checked_at?: string | null
          snippet_found_at?: string | null
          state?: string | null
          tracking_code?: string
          trusted_sources?: string[]
          updated_at?: string
        }
        Update: {
          brand_rules?: string[]
          client_logo_path?: string | null
          content_byline?: boolean
          content_quality_handoff?: boolean
          conversions_consent?: string
          conversions_enabled?: boolean
          created_at?: string
          demo_built_at?: string | null
          demo_hidden_at?: string | null
          demo_version?: number | null
          description?: string | null
          ga_property_id?: string | null
          gsc_pages_backfill_from?: string | null
          gsc_pages_backfilled_property?: string | null
          gsc_property?: string | null
          gsc_shopping_property?: string | null
          gsc_shopping_synced_at?: string | null
          id?: string
          industry?: string | null
          insights_pinned_competitors?: string[]
          is_active?: boolean
          is_demo?: boolean
          kpi_setup_at?: string | null
          language?: string | null
          logo_url?: string | null
          name?: string
          openai_product_feed?: boolean
          organization_id?: string
          region?: string | null
          shopping_mode_enabled?: boolean
          site_type?: string | null
          site_type_detected_at?: string | null
          site_type_source?: string | null
          slug?: string
          snippet_checked_at?: string | null
          snippet_found_at?: string | null
          state?: string | null
          tracking_code?: string
          trusted_sources?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_usage: {
        Row: {
          created_at: string | null
          id: string
          opportunity_id: string | null
          organization_id: string
          used_at: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          organization_id: string
          used_at?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          organization_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_usage_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_feedback: {
        Row: {
          choice: string
          created_at: string
          created_by: string | null
          email_status: string | null
          id: string
          message: string
          organization_id: string
          plan: string | null
          reasons: string[]
          subscription_status: string | null
        }
        Insert: {
          choice: string
          created_at?: string
          created_by?: string | null
          email_status?: string | null
          id?: string
          message?: string
          organization_id: string
          plan?: string | null
          reasons?: string[]
          subscription_status?: string | null
        }
        Update: {
          choice?: string
          created_at?: string
          created_by?: string | null
          email_status?: string | null
          id?: string
          message?: string
          organization_id?: string
          plan?: string | null
          reasons?: string[]
          subscription_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_images: {
        Row: {
          brand_id: string
          id: string
          position: number
          product_id: string
          url: string
          variant_id: string | null
        }
        Insert: {
          brand_id: string
          id?: string
          position?: number
          product_id: string
          url: string
          variant_id?: string | null
        }
        Update: {
          brand_id?: string
          id?: string
          position?: number
          product_id?: string
          url?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_images_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_item_issues: {
        Row: {
          attribute: string | null
          brand_id: string
          code: string
          countries: string[]
          created_at: string
          description: string | null
          detail: string | null
          documentation: string | null
          external_id: string
          id: string
          reporting_context: string | null
          resolution: string | null
          severity: string
          source_id: string
        }
        Insert: {
          attribute?: string | null
          brand_id: string
          code: string
          countries?: string[]
          created_at?: string
          description?: string | null
          detail?: string | null
          documentation?: string | null
          external_id: string
          id?: string
          reporting_context?: string | null
          resolution?: string | null
          severity: string
          source_id: string
        }
        Update: {
          attribute?: string | null
          brand_id?: string
          code?: string
          countries?: string[]
          created_at?: string
          description?: string | null
          detail?: string | null
          documentation?: string | null
          external_id?: string
          id?: string
          reporting_context?: string | null
          resolution?: string | null
          severity?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_issues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_issues_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "catalog_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_products: {
        Row: {
          brand_id: string
          content_hash: string
          description: string | null
          external_id: string
          first_seen_at: string
          id: string
          product_brand: string | null
          product_type: string | null
          removed_at: string | null
          source: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          brand_id: string
          content_hash: string
          description?: string | null
          external_id: string
          first_seen_at?: string
          id?: string
          product_brand?: string | null
          product_type?: string | null
          removed_at?: string | null
          source: string
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          brand_id?: string
          content_hash?: string
          description?: string | null
          external_id?: string
          first_seen_at?: string
          id?: string
          product_brand?: string | null
          product_type?: string | null
          removed_at?: string | null
          source?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_source_credentials: {
        Row: {
          secret: string
          set_at: string
          set_by: string | null
          source_id: string
        }
        Insert: {
          secret: string
          set_at?: string
          set_by?: string | null
          source_id: string
        }
        Update: {
          secret?: string
          set_at?: string
          set_by?: string | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_source_credentials_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_source_credentials_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "catalog_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_sources: {
        Row: {
          account: string | null
          brand_id: string
          created_at: string
          created_by: string | null
          format: string
          id: string
          kind: string
          label: string | null
          last_counts: Json | null
          last_error: string | null
          last_status: string | null
          last_synced_at: string | null
          url: string | null
        }
        Insert: {
          account?: string | null
          brand_id: string
          created_at?: string
          created_by?: string | null
          format?: string
          id?: string
          kind: string
          label?: string | null
          last_counts?: Json | null
          last_error?: string | null
          last_status?: string | null
          last_synced_at?: string | null
          url?: string | null
        }
        Update: {
          account?: string | null
          brand_id?: string
          created_at?: string
          created_by?: string | null
          format?: string
          id?: string
          kind?: string
          label?: string | null
          last_counts?: Json | null
          last_error?: string | null
          last_status?: string | null
          last_synced_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_sources_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_categories: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_categories_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_product_categories: {
        Row: {
          brand_id: string
          category_id: string
          product_id: string
        }
        Insert: {
          brand_id: string
          category_id: string
          product_id: string
        }
        Update: {
          brand_id?: string
          category_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_categories_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_variants: {
        Row: {
          attributes: Json
          availability: string | null
          brand_id: string
          condition: string | null
          content_hash: string
          currency: string | null
          external_id: string
          first_seen_at: string
          gtin: string | null
          id: string
          marketplace_item_id: string | null
          mpn: string | null
          price: number | null
          product_id: string
          removed_at: string | null
          sale_price: number | null
          sku: string | null
          source: string
          title: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          attributes?: Json
          availability?: string | null
          brand_id: string
          condition?: string | null
          content_hash: string
          currency?: string | null
          external_id: string
          first_seen_at?: string
          gtin?: string | null
          id?: string
          marketplace_item_id?: string | null
          mpn?: string | null
          price?: number | null
          product_id: string
          removed_at?: string | null
          sale_price?: number | null
          sku?: string | null
          source: string
          title?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          attributes?: Json
          availability?: string | null
          brand_id?: string
          condition?: string | null
          content_hash?: string
          currency?: string | null
          external_id?: string
          first_seen_at?: string
          gtin?: string | null
          id?: string
          marketplace_item_id?: string | null
          mpn?: string | null
          price?: number | null
          product_id?: string
          removed_at?: string | null
          sale_price?: number | null
          sku?: string | null
          source?: string
          title?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_variants_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_access_requests: {
        Row: {
          asked: string
          asked_hash: string
          brand_id: string | null
          conversation_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          drafted_change: Json | null
          id: string
          organization_id: string
          requested_on: string
          requester_id: string
          rule_detail: string
          rule_kind: string
          status: string
          tool_key: string | null
        }
        Insert: {
          asked: string
          asked_hash: string
          brand_id?: string | null
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          drafted_change?: Json | null
          id?: string
          organization_id: string
          requested_on?: string
          requester_id: string
          rule_detail?: string
          rule_kind: string
          status?: string
          tool_key?: string | null
        }
        Update: {
          asked?: string
          asked_hash?: string
          brand_id?: string | null
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          drafted_change?: Json | null
          id?: string
          organization_id?: string
          requested_on?: string
          requester_id?: string
          rule_detail?: string
          rule_kind?: string
          status?: string
          tool_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_access_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_access_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_activity_log: {
        Row: {
          agent_id: string | null
          agent_run_id: string | null
          approval_kind: string | null
          auto_via: string | null
          brand_id: string | null
          class: string
          conversation_id: string | null
          created_at: string
          denial_code: string | null
          denial_json: Json | null
          id: string
          kind: string
          mode: string | null
          organization_id: string
          run_id: string | null
          status: string
          step_id: string | null
          summary_key: string
          summary_params: Json
          surface: string
          target_id: string | null
          target_type: string | null
          tool_key: string
          undo_json: Json | null
          undo_until: string | null
          undoes_id: string | null
          undone_at: string | null
          undone_by: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_run_id?: string | null
          approval_kind?: string | null
          auto_via?: string | null
          brand_id?: string | null
          class: string
          conversation_id?: string | null
          created_at?: string
          denial_code?: string | null
          denial_json?: Json | null
          id?: string
          kind?: string
          mode?: string | null
          organization_id: string
          run_id?: string | null
          status?: string
          step_id?: string | null
          summary_key: string
          summary_params?: Json
          surface: string
          target_id?: string | null
          target_type?: string | null
          tool_key: string
          undo_json?: Json | null
          undo_until?: string | null
          undoes_id?: string | null
          undone_at?: string | null
          undone_by?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_run_id?: string | null
          approval_kind?: string | null
          auto_via?: string | null
          brand_id?: string | null
          class?: string
          conversation_id?: string | null
          created_at?: string
          denial_code?: string | null
          denial_json?: Json | null
          id?: string
          kind?: string
          mode?: string | null
          organization_id?: string
          run_id?: string | null
          status?: string
          step_id?: string | null
          summary_key?: string
          summary_params?: Json
          surface?: string
          target_id?: string | null
          target_type?: string | null
          tool_key?: string
          undo_json?: Json | null
          undo_until?: string | null
          undoes_id?: string | null
          undone_at?: string | null
          undone_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_activity_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "chat_run_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_activity_log_undoes_id_fkey"
            columns: ["undoes_id"]
            isOneToOne: false
            referencedRelation: "chat_activity_log"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_agent_go_live: {
        Row: {
          agent_id: string
          daily_limit: number
          granted_at: string
          granted_by: string | null
          organization_id: string
          skill_checksums: Json
          version: number
        }
        Insert: {
          agent_id: string
          daily_limit?: number
          granted_at?: string
          granted_by?: string | null
          organization_id: string
          skill_checksums?: Json
          version: number
        }
        Update: {
          agent_id?: string
          daily_limit?: number
          granted_at?: string
          granted_by?: string | null
          organization_id?: string
          skill_checksums?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_agent_go_live_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_agent_go_live_events: {
        Row: {
          agent_id: string | null
          agent_run_id: string | null
          brand_id: string
          content_draft_id: string | null
          created_at: string
          delivery_id: string | null
          error: string | null
          external_id: string | null
          finished_at: string | null
          id: string
          kind: string
          organization_id: string
          published_url: string | null
          run_id: string | null
          status: string
          taken_down_at: string | null
          taken_down_by: string | null
          target: string
          tool_key: string
        }
        Insert: {
          agent_id?: string | null
          agent_run_id?: string | null
          brand_id: string
          content_draft_id?: string | null
          created_at?: string
          delivery_id?: string | null
          error?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          organization_id: string
          published_url?: string | null
          run_id?: string | null
          status?: string
          taken_down_at?: string | null
          taken_down_by?: string | null
          target: string
          tool_key: string
        }
        Update: {
          agent_id?: string | null
          agent_run_id?: string | null
          brand_id?: string
          content_draft_id?: string | null
          created_at?: string
          delivery_id?: string | null
          error?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          organization_id?: string
          published_url?: string | null
          run_id?: string | null
          status?: string
          taken_down_at?: string | null
          taken_down_by?: string | null
          target?: string
          tool_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_agent_go_live_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_events_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_events_content_draft_id_fkey"
            columns: ["content_draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "content_draft_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_go_live_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_agent_runs: {
        Row: {
          acting_user_id: string | null
          action_id: string | null
          agent_id: string | null
          agent_version: number
          brand_id: string | null
          called_by_run_id: string | null
          evidence_json: Json
          finished_at: string | null
          id: string
          max_share: number
          organization_id: string
          outcome: string | null
          outcome_confidence: string | null
          queued_at: string
          skipped_reason: string | null
          started_at: string | null
          status: string
          stop_reason: string | null
          trigger_id: string | null
          trigger_kind: string
          trigger_ref: string | null
          usage_share: number
        }
        Insert: {
          acting_user_id?: string | null
          action_id?: string | null
          agent_id?: string | null
          agent_version: number
          brand_id?: string | null
          called_by_run_id?: string | null
          evidence_json?: Json
          finished_at?: string | null
          id?: string
          max_share?: number
          organization_id: string
          outcome?: string | null
          outcome_confidence?: string | null
          queued_at?: string
          skipped_reason?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          trigger_id?: string | null
          trigger_kind: string
          trigger_ref?: string | null
          usage_share?: number
        }
        Update: {
          acting_user_id?: string | null
          action_id?: string | null
          agent_id?: string | null
          agent_version?: number
          brand_id?: string | null
          called_by_run_id?: string | null
          evidence_json?: Json
          finished_at?: string | null
          id?: string
          max_share?: number
          organization_id?: string
          outcome?: string | null
          outcome_confidence?: string | null
          queued_at?: string
          skipped_reason?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          trigger_id?: string | null
          trigger_kind?: string
          trigger_ref?: string | null
          usage_share?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_agent_runs_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_runs_called_by_run_id_fkey"
            columns: ["called_by_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_agent_runs_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_agent_triggers: {
        Row: {
          agent_id: string
          config_json: Json
          cooldown_until: string | null
          created_at: string
          enabled: boolean
          id: string
          kind: string
          last_fired_at: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          config_json?: Json
          cooldown_until?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          kind: string
          last_fired_at?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          config_json?: Json
          cooldown_until?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          last_fired_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_agent_triggers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_agent_versions: {
        Row: {
          agent_id: string
          can_call: string[]
          connections: Json
          created_at: string
          created_by: string | null
          effort: string
          followup_days: number
          instructions: string | null
          mode: string
          model: string
          notify_user_ids: string[]
          scope: Json
          skill_ids: string[]
          version: number
        }
        Insert: {
          agent_id: string
          can_call?: string[]
          connections?: Json
          created_at?: string
          created_by?: string | null
          effort?: string
          followup_days?: number
          instructions?: string | null
          mode?: string
          model?: string
          notify_user_ids?: string[]
          scope?: Json
          skill_ids: string[]
          version: number
        }
        Update: {
          agent_id?: string
          can_call?: string[]
          connections?: Json
          created_at?: string
          created_by?: string | null
          effort?: string
          followup_days?: number
          instructions?: string | null
          mode?: string
          model?: string
          notify_user_ids?: string[]
          scope?: Json
          skill_ids?: string[]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_agent_versions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_agents: {
        Row: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          fail_count: number
          id: string
          max_month_share: number | null
          max_run_share: number
          name: string
          organization_id: string
          owner_id: string | null
          paused_reason: string | null
          status: string
          updated_at: string
          version: number
          visibility: string
        }
        Insert: {
          activated_at?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          fail_count?: number
          id?: string
          max_month_share?: number | null
          max_run_share?: number
          name: string
          organization_id: string
          owner_id?: string | null
          paused_reason?: string | null
          status?: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Update: {
          activated_at?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          fail_count?: number
          id?: string
          max_month_share?: number | null
          max_run_share?: number
          name?: string
          organization_id?: string
          owner_id?: string | null
          paused_reason?: string | null
          status?: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_asks: {
        Row: {
          allow_other: boolean
          answer_json: Json | null
          answered_at: string | null
          created_at: string
          id: string
          multi: boolean
          options_json: Json
          position: number
          question: string
          run_id: string
          step_id: string
        }
        Insert: {
          allow_other?: boolean
          answer_json?: Json | null
          answered_at?: string | null
          created_at?: string
          id?: string
          multi?: boolean
          options_json: Json
          position: number
          question: string
          run_id: string
          step_id: string
        }
        Update: {
          allow_other?: boolean
          answer_json?: Json | null
          answered_at?: string | null
          created_at?: string
          id?: string
          multi?: boolean
          options_json?: Json
          position?: number
          question?: string
          run_id?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_asks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_asks_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "chat_run_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_auto_choices: {
        Row: {
          created_at: string
          organization_id: string
          tool_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          tool_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          tool_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_auto_choices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          agent_run_id: string | null
          archived_at: string | null
          brand_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          last_message_at: string
          last_read_at: string | null
          organization_id: string
          origin: string
          origin_page: string | null
          pinned_at: string | null
          schedule_id: string | null
          search_tsv: unknown
          shared_at: string | null
          title: string | null
          touched_brand_ids: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_run_id?: string | null
          archived_at?: string | null
          brand_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_message_at?: string
          last_read_at?: string | null
          organization_id: string
          origin?: string
          origin_page?: string | null
          pinned_at?: string | null
          schedule_id?: string | null
          search_tsv?: never
          shared_at?: string | null
          title?: string | null
          touched_brand_ids?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_run_id?: string | null
          archived_at?: string | null
          brand_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_message_at?: string
          last_read_at?: string | null
          organization_id?: string
          origin?: string
          origin_page?: string | null
          pinned_at?: string | null
          schedule_id?: string | null
          search_tsv?: never
          shared_at?: string | null
          title?: string | null
          touched_brand_ids?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "chat_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_file_task_links: {
        Row: {
          action_task_id: string
          attached_at: string
          attached_by: string | null
          file_id: string
        }
        Insert: {
          action_task_id: string
          attached_at?: string
          attached_by?: string | null
          file_id: string
        }
        Update: {
          action_task_id?: string
          attached_at?: string
          attached_by?: string | null
          file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_file_task_links_action_task_id_fkey"
            columns: ["action_task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_file_task_links_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "chat_files"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_files: {
        Row: {
          audience: string
          brand_id: string | null
          content_draft_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          data_as_of: string | null
          expires_at: string
          formats: string[]
          generated_at: string
          id: string
          message_id: string | null
          mime_type: string
          organization_id: string
          origin: string
          run_id: string | null
          search_tsv: unknown
          size_bytes: number
          status: string
          storage_path: string
          summary: string | null
          tags: string[]
          timezone: string | null
          title: string
          touched_brand_ids: string[] | null
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          audience?: string
          brand_id?: string | null
          content_draft_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          data_as_of?: string | null
          expires_at?: string
          formats?: string[]
          generated_at?: string
          id?: string
          message_id?: string | null
          mime_type: string
          organization_id: string
          origin: string
          run_id?: string | null
          search_tsv?: never
          size_bytes?: number
          status?: string
          storage_path: string
          summary?: string | null
          tags?: string[]
          timezone?: string | null
          title: string
          touched_brand_ids?: string[] | null
          type: string
          updated_at?: string
          version?: number
        }
        Update: {
          audience?: string
          brand_id?: string | null
          content_draft_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          data_as_of?: string | null
          expires_at?: string
          formats?: string[]
          generated_at?: string
          id?: string
          message_id?: string | null
          mime_type?: string
          organization_id?: string
          origin?: string
          run_id?: string | null
          search_tsv?: never
          size_bytes?: number
          status?: string
          storage_path?: string
          summary?: string | null
          tags?: string[]
          timezone?: string | null
          title?: string
          touched_brand_ids?: string[] | null
          type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_files_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_content_draft_id_fkey"
            columns: ["content_draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_idempotency_keys: {
        Row: {
          activity_id: string | null
          created_at: string
          expires_at: string
          key: string
          organization_id: string
          request_hash: string
          result_json: Json | null
          status: string
        }
        Insert: {
          activity_id?: string | null
          created_at?: string
          expires_at?: string
          key: string
          organization_id: string
          request_hash: string
          result_json?: Json | null
          status?: string
        }
        Update: {
          activity_id?: string | null
          created_at?: string
          expires_at?: string
          key?: string
          organization_id?: string
          request_hash?: string
          result_json?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_idempotency_keys_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "chat_activity_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_idempotency_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_memory_items: {
        Row: {
          brand_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          edited: boolean
          id: string
          organization_id: string
          scope: string
          source: string
          source_ref: string | null
          text: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          edited?: boolean
          id?: string
          organization_id: string
          scope: string
          source: string
          source_ref?: string | null
          text: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          edited?: boolean
          id?: string
          organization_id?: string
          scope?: string
          source?: string
          source_ref?: string | null
          text?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_memory_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_memory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content_md: string
          context_json: Json | null
          conversation_id: string
          created_at: string
          data_as_of: string | null
          generated_at: string | null
          id: string
          role: string
          search_tsv: unknown
          shortcut_id: string | null
          timezone: string | null
        }
        Insert: {
          content_md?: string
          context_json?: Json | null
          conversation_id: string
          created_at?: string
          data_as_of?: string | null
          generated_at?: string | null
          id?: string
          role: string
          search_tsv?: never
          shortcut_id?: string | null
          timezone?: string | null
        }
        Update: {
          content_md?: string
          context_json?: Json | null
          conversation_id?: string
          created_at?: string
          data_as_of?: string | null
          generated_at?: string | null
          id?: string
          role?: string
          search_tsv?: never
          shortcut_id?: string | null
          timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_next_moves: {
        Row: {
          class: string
          created_at: string
          ghost_ok: boolean
          id: string
          label: string
          prompt: string
          rank: number
          run_id: string
        }
        Insert: {
          class: string
          created_at?: string
          ghost_ok?: boolean
          id?: string
          label: string
          prompt: string
          rank: number
          run_id: string
        }
        Update: {
          class?: string
          created_at?: string
          ghost_ok?: boolean
          id?: string
          label?: string
          prompt?: string
          rank?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_next_moves_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_notices: {
        Row: {
          brand_id: string | null
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          organization_id: string
          payload: Json
          read_at: string | null
          resolved_at: string | null
          user_id: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          organization_id: string
          payload?: Json
          read_at?: string | null
          resolved_at?: string | null
          user_id: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          organization_id?: string
          payload?: Json
          read_at?: string | null
          resolved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_notices_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_notices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_outbound_emails: {
        Row: {
          approved_by: string | null
          created_at: string
          expires_at: string
          files: Json
          id: string
          organization_id: string
          resend_id: string | null
          schedule_id: string
          schedule_run_id: string | null
          send_error: string | null
          sent_at: string | null
          status: string
          subject: string
          summary: string
          to_address: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          expires_at?: string
          files?: Json
          id?: string
          organization_id: string
          resend_id?: string | null
          schedule_id: string
          schedule_run_id?: string | null
          send_error?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          summary: string
          to_address: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          expires_at?: string
          files?: Json
          id?: string
          organization_id?: string
          resend_id?: string | null
          schedule_id?: string
          schedule_run_id?: string | null
          send_error?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          summary?: string
          to_address?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_outbound_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_outbound_emails_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "chat_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_outbound_emails_schedule_run_id_fkey"
            columns: ["schedule_run_id"]
            isOneToOne: false
            referencedRelation: "chat_schedule_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_run_events: {
        Row: {
          created_at: string
          data: Json
          run_id: string
          seq: number
          type: string
        }
        Insert: {
          created_at?: string
          data: Json
          run_id: string
          seq: number
          type: string
        }
        Update: {
          created_at?: string
          data?: Json
          run_id?: string
          seq?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_run_state: {
        Row: {
          heartbeat_at: string | null
          last_seq: number
          messages: Json
          mode: string
          organization_id: string
          pending: Json | null
          progress: Json
          run_id: string
          updated_at: string
          user_id: string
          waiting_since: string | null
          working_ms: number
        }
        Insert: {
          heartbeat_at?: string | null
          last_seq?: number
          messages?: Json
          mode?: string
          organization_id: string
          pending?: Json | null
          progress?: Json
          run_id: string
          updated_at?: string
          user_id: string
          waiting_since?: string | null
          working_ms?: number
        }
        Update: {
          heartbeat_at?: string | null
          last_seq?: number
          messages?: Json
          mode?: string
          organization_id?: string
          pending?: Json | null
          progress?: Json
          run_id?: string
          updated_at?: string
          user_id?: string
          waiting_since?: string | null
          working_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_run_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_run_state_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_run_steps: {
        Row: {
          cache_hit: boolean
          data_as_of: string | null
          debug_json: Json | null
          detail: string | null
          finished_at: string | null
          id: string
          kind: string
          label: string
          latency_ms: number | null
          position: number
          result_tokens: number | null
          row_count: number | null
          run_id: string
          scope_json: Json | null
          started_at: string | null
          status: string
          tool: string | null
          truncated: boolean
        }
        Insert: {
          cache_hit?: boolean
          data_as_of?: string | null
          debug_json?: Json | null
          detail?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          label: string
          latency_ms?: number | null
          position: number
          result_tokens?: number | null
          row_count?: number | null
          run_id: string
          scope_json?: Json | null
          started_at?: string | null
          status?: string
          tool?: string | null
          truncated?: boolean
        }
        Update: {
          cache_hit?: boolean
          data_as_of?: string | null
          debug_json?: Json | null
          detail?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          label?: string
          latency_ms?: number | null
          position?: number
          result_tokens?: number | null
          row_count?: number | null
          run_id?: string
          scope_json?: Json | null
          started_at?: string | null
          status?: string
          tool?: string | null
          truncated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "chat_run_steps_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "chat_step_kinds"
            referencedColumns: ["kind"]
          },
          {
            foreignKeyName: "chat_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_runs: {
        Row: {
          conversation_id: string
          created_at: string
          effort: string
          error: string | null
          finished_at: string | null
          id: string
          message_id: string | null
          model: string
          parent_run_id: string | null
          started_at: string | null
          status: string
          subtask_title: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          effort?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          message_id?: string | null
          model?: string
          parent_run_id?: string | null
          started_at?: string | null
          status?: string
          subtask_title?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          effort?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          message_id?: string | null
          model?: string
          parent_run_id?: string | null
          started_at?: string | null
          status?: string
          subtask_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_runs_message_id_conversation_id_fkey"
            columns: ["message_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id", "conversation_id"]
          },
          {
            foreignKeyName: "chat_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_schedule_runs: {
        Row: {
          attempt: number
          email_status: string | null
          ended_at: string | null
          fingerprint: string | null
          id: string
          message_id: string | null
          parts_done: number
          parts_total: number
          reason: string | null
          resend_message_id: string | null
          run_id: string | null
          run_now: boolean
          schedule_id: string
          slot_at: string
          started_at: string
          status: string
          usage_share: number
        }
        Insert: {
          attempt?: number
          email_status?: string | null
          ended_at?: string | null
          fingerprint?: string | null
          id?: string
          message_id?: string | null
          parts_done?: number
          parts_total?: number
          reason?: string | null
          resend_message_id?: string | null
          run_id?: string | null
          run_now?: boolean
          schedule_id: string
          slot_at: string
          started_at?: string
          status?: string
          usage_share?: number
        }
        Update: {
          attempt?: number
          email_status?: string | null
          ended_at?: string | null
          fingerprint?: string | null
          id?: string
          message_id?: string | null
          parts_done?: number
          parts_total?: number
          reason?: string | null
          resend_message_id?: string | null
          run_id?: string | null
          run_now?: boolean
          schedule_id?: string
          slot_at?: string
          started_at?: string
          status?: string
          usage_share?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_schedule_runs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedule_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedule_runs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "chat_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_schedules: {
        Row: {
          agent_id: string | null
          agent_run_id: string | null
          brand_id: string | null
          change_only: boolean
          conversation_id: string | null
          created_at: string
          created_by: string | null
          created_via: string
          deliver_to: string[]
          due_at: string | null
          effort: string
          enabled: boolean
          external_recipients: string[]
          fail_count: number
          id: string
          kind: string
          last_fingerprint: string | null
          last_run_at: string | null
          metric: string | null
          mode: string
          model: string
          next_run_at: string | null
          organization_id: string
          paused_reason: string | null
          prompt: string | null
          recipient_ids: string[]
          retry_at: string | null
          rrule: string | null
          run_mode: string
          set_by_run_id: string | null
          skill_name: string | null
          target_json: Json | null
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          agent_run_id?: string | null
          brand_id?: string | null
          change_only?: boolean
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          deliver_to?: string[]
          due_at?: string | null
          effort?: string
          enabled?: boolean
          external_recipients?: string[]
          fail_count?: number
          id?: string
          kind: string
          last_fingerprint?: string | null
          last_run_at?: string | null
          metric?: string | null
          mode?: string
          model?: string
          next_run_at?: string | null
          organization_id: string
          paused_reason?: string | null
          prompt?: string | null
          recipient_ids?: string[]
          retry_at?: string | null
          rrule?: string | null
          run_mode?: string
          set_by_run_id?: string | null
          skill_name?: string | null
          target_json?: Json | null
          timezone: string
          title: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          agent_run_id?: string | null
          brand_id?: string | null
          change_only?: boolean
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          deliver_to?: string[]
          due_at?: string | null
          effort?: string
          enabled?: boolean
          external_recipients?: string[]
          fail_count?: number
          id?: string
          kind?: string
          last_fingerprint?: string | null
          last_run_at?: string | null
          metric?: string | null
          mode?: string
          model?: string
          next_run_at?: string | null
          organization_id?: string
          paused_reason?: string | null
          prompt?: string | null
          recipient_ids?: string[]
          retry_at?: string | null
          rrule?: string | null
          run_mode?: string
          set_by_run_id?: string | null
          skill_name?: string | null
          target_json?: Json | null
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_schedules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedules_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedules_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_schedules_set_by_run_id_fkey"
            columns: ["set_by_run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_settings: {
        Row: {
          agent_run_share_default: number
          agents_full_auto: boolean
          auto_go_live_at: string | null
          auto_go_live_by: string | null
          auto_go_live_groups: string[]
          auto_go_live_terms: number | null
          disabled_skills: string[]
          dont_ask_again: boolean
          full_auto_for_members: boolean
          manager_execute_off: string[]
          memory_enabled: boolean
          organization_id: string
          own_key_agent_month_usd: number
          tool_policies: Json
          updated_at: string
          updated_by: string | null
          workspace_agents_admins_only: boolean
        }
        Insert: {
          agent_run_share_default?: number
          agents_full_auto?: boolean
          auto_go_live_at?: string | null
          auto_go_live_by?: string | null
          auto_go_live_groups?: string[]
          auto_go_live_terms?: number | null
          disabled_skills?: string[]
          dont_ask_again?: boolean
          full_auto_for_members?: boolean
          manager_execute_off?: string[]
          memory_enabled?: boolean
          organization_id: string
          own_key_agent_month_usd?: number
          tool_policies?: Json
          updated_at?: string
          updated_by?: string | null
          workspace_agents_admins_only?: boolean
        }
        Update: {
          agent_run_share_default?: number
          agents_full_auto?: boolean
          auto_go_live_at?: string | null
          auto_go_live_by?: string | null
          auto_go_live_groups?: string[]
          auto_go_live_terms?: number | null
          disabled_skills?: string[]
          dont_ask_again?: boolean
          full_auto_for_members?: boolean
          manager_execute_off?: string[]
          memory_enabled?: boolean
          organization_id?: string
          own_key_agent_month_usd?: number
          tool_policies?: Json
          updated_at?: string
          updated_by?: string | null
          workspace_agents_admins_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "chat_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_skills: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          checksum_sha256: string
          commit_sha: string | null
          compatibility: string | null
          created_at: string
          created_by: string | null
          description: string
          enabled: boolean
          id: string
          library_ref: string | null
          license: string | null
          license_text: string | null
          name: string
          organization_id: string
          removed_json: Json
          scan_json: Json
          source: string
          source_url: string | null
          status: string
          title: string
          update_checked_at: string | null
          update_sha: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body: string
          checksum_sha256: string
          commit_sha?: string | null
          compatibility?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          enabled?: boolean
          id?: string
          library_ref?: string | null
          license?: string | null
          license_text?: string | null
          name: string
          organization_id: string
          removed_json?: Json
          scan_json?: Json
          source?: string
          source_url?: string | null
          status?: string
          title: string
          update_checked_at?: string | null
          update_sha?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          checksum_sha256?: string
          commit_sha?: string | null
          compatibility?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          id?: string
          library_ref?: string | null
          license?: string | null
          license_text?: string | null
          name?: string
          organization_id?: string
          removed_json?: Json
          scan_json?: Json
          source?: string
          source_url?: string | null
          status?: string
          title?: string
          update_checked_at?: string | null
          update_sha?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_step_kinds: {
        Row: {
          kind: string
        }
        Insert: {
          kind: string
        }
        Update: {
          kind?: string
        }
        Relationships: []
      }
      chat_storage_usage: {
        Row: {
          bytes_used: number
          file_count: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          bytes_used?: number
          file_count?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          bytes_used?: number
          file_count?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_storage_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_suggestion_feeds: {
        Row: {
          brand_id: string
          created_at: string
          last_used_at: string | null
          organization_id: string
          paused_at: string | null
          reminded_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          last_used_at?: string | null
          organization_id: string
          paused_at?: string | null
          reminded_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          last_used_at?: string | null
          organization_id?: string
          paused_at?: string | null
          reminded_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_suggestion_feeds_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_suggestion_feeds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_suggestions: {
        Row: {
          action_id: string
          brand_id: string
          id: string
          opened_at: string | null
          organization_id: string
          removed_at: string | null
          seen_at: string | null
          sent_at: string
          sent_on: string
          snoozed_until: string | null
          started_at: string | null
          started_via: string | null
          summary: Json
          user_id: string
        }
        Insert: {
          action_id: string
          brand_id: string
          id?: string
          opened_at?: string | null
          organization_id: string
          removed_at?: string | null
          seen_at?: string | null
          sent_at?: string
          sent_on: string
          snoozed_until?: string | null
          started_at?: string | null
          started_via?: string | null
          summary?: Json
          user_id: string
        }
        Update: {
          action_id?: string
          brand_id?: string
          id?: string
          opened_at?: string | null
          organization_id?: string
          removed_at?: string | null
          seen_at?: string | null
          sent_at?: string
          sent_on?: string
          snoozed_until?: string | null
          started_at?: string | null
          started_via?: string | null
          summary?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_suggestions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_task_state: {
        Row: {
          action_task_id: string
          chat_status: string
          conversation_id: string
          created_at: string
          file_id: string | null
          position: number
          run_id: string | null
          updated_at: string
        }
        Insert: {
          action_task_id: string
          chat_status?: string
          conversation_id: string
          created_at?: string
          file_id?: string | null
          position: number
          run_id?: string | null
          updated_at?: string
        }
        Update: {
          action_task_id?: string
          chat_status?: string
          conversation_id?: string
          created_at?: string
          file_id?: string | null
          position?: number
          run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_task_state_action_task_id_fkey"
            columns: ["action_task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_task_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_task_state_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "chat_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_task_state_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_tool_cache: {
        Row: {
          brand_id: string | null
          conversation_id: string
          created_at: string
          data_as_of: string | null
          expires_at: string
          hits: number
          last_hit_at: string | null
          result_json: Json
          row_count: number | null
          scope_hash: string
          tool: string
        }
        Insert: {
          brand_id?: string | null
          conversation_id: string
          created_at?: string
          data_as_of?: string | null
          expires_at?: string
          hits?: number
          last_hit_at?: string | null
          result_json: Json
          row_count?: number | null
          scope_hash: string
          tool: string
        }
        Update: {
          brand_id?: string | null
          conversation_id?: string
          created_at?: string
          data_as_of?: string | null
          expires_at?: string
          hits?: number
          last_hit_at?: string | null
          result_json?: Json
          row_count?: number | null
          scope_hash?: string
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_tool_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_tool_cache_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_uploads: {
        Row: {
          conversation_id: string | null
          created_at: string
          expires_at: string
          id: string
          message_id: string | null
          mime_type: string
          name: string
          organization_id: string
          size_bytes: number
          status: string
          storage_path: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          message_id?: string | null
          mime_type: string
          name: string
          organization_id: string
          size_bytes: number
          status?: string
          storage_path: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          message_id?: string | null
          mime_type?: string
          name?: string
          organization_id?: string
          size_bytes?: number
          status?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_uploads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_uploads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_user_prefs: {
        Row: {
          answer_language: string | null
          default_mode: string
          effort: string | null
          focus: string[] | null
          focus_prompted_at: string | null
          home_seen_at: string | null
          legacy_imported_at: string | null
          memory_enabled: boolean
          menu_open: boolean
          model: string | null
          notify_via: string
          page_open: string
          panel_on_pages: boolean
          panel_size: string
          rail_open: boolean
          show_thought: boolean
          updated_at: string
          usage_notice_period: string | null
          user_id: string
        }
        Insert: {
          answer_language?: string | null
          default_mode?: string
          effort?: string | null
          focus?: string[] | null
          focus_prompted_at?: string | null
          home_seen_at?: string | null
          legacy_imported_at?: string | null
          memory_enabled?: boolean
          menu_open?: boolean
          model?: string | null
          notify_via?: string
          page_open?: string
          panel_on_pages?: boolean
          panel_size?: string
          rail_open?: boolean
          show_thought?: boolean
          updated_at?: string
          usage_notice_period?: string | null
          user_id: string
        }
        Update: {
          answer_language?: string | null
          default_mode?: string
          effort?: string | null
          focus?: string[] | null
          focus_prompted_at?: string | null
          home_seen_at?: string | null
          legacy_imported_at?: string | null
          memory_enabled?: boolean
          menu_open?: boolean
          model?: string | null
          notify_via?: string
          page_open?: string
          panel_on_pages?: boolean
          panel_size?: string
          rail_open?: boolean
          show_thought?: boolean
          updated_at?: string
          usage_notice_period?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_whats_new_reads: {
        Row: {
          entry_slug: string
          read_at: string
          user_id: string
        }
        Insert: {
          entry_slug: string
          read_at?: string
          user_id: string
        }
        Update: {
          entry_slug?: string
          read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_why_analyses: {
        Row: {
          brand_id: string
          conversation_id: string
          created_at: string
          data_as_of: string | null
          id: string
          metric: string
          period_a_end: string
          period_a_start: string
          period_b_end: string
          period_b_start: string
          result_json: Json
          run_id: string | null
          scope_json: Json
        }
        Insert: {
          brand_id: string
          conversation_id: string
          created_at?: string
          data_as_of?: string | null
          id?: string
          metric: string
          period_a_end: string
          period_a_start: string
          period_b_end: string
          period_b_start: string
          result_json: Json
          run_id?: string | null
          scope_json?: Json
        }
        Update: {
          brand_id?: string
          conversation_id?: string
          created_at?: string
          data_as_of?: string | null
          id?: string
          metric?: string
          period_a_end?: string
          period_a_start?: string
          period_b_end?: string
          period_b_start?: string
          result_json?: Json
          run_id?: string | null
          scope_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "chat_why_analyses_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_why_analyses_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_why_analyses_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      citation_urls: {
        Row: {
          domain: string
          first_seen_at: string
          id: number
          title: string | null
          url: string
        }
        Insert: {
          domain: string
          first_seen_at?: string
          id?: never
          title?: string | null
          url: string
        }
        Update: {
          domain?: string
          first_seen_at?: string
          id?: never
          title?: string | null
          url?: string
        }
        Relationships: []
      }
      cloro_countries: {
        Row: {
          country: string
          model: string
          refreshed_at: string
        }
        Insert: {
          country: string
          model: string
          refreshed_at?: string
        }
        Update: {
          country?: string
          model?: string
          refreshed_at?: string
        }
        Relationships: []
      }
      cloro_pending_tasks: {
        Row: {
          brand_id: string
          legacy: boolean
          prompt_id: string
          region: string | null
          scraper_id: string
          submitted_at: string
          task_id: string
        }
        Insert: {
          brand_id: string
          legacy?: boolean
          prompt_id: string
          region?: string | null
          scraper_id: string
          submitted_at?: string
          task_id: string
        }
        Update: {
          brand_id?: string
          legacy?: boolean
          prompt_id?: string
          region?: string | null
          scraper_id?: string
          submitted_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloro_pending_tasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloro_pending_tasks_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_page_events: {
        Row: {
          at: string
          brand_id: string
          competitor_id: string
          created_at: string
          detail: Json
          domain: string
          id: string
          kind: string
          page_key: string
          url: string
        }
        Insert: {
          at: string
          brand_id: string
          competitor_id: string
          created_at?: string
          detail?: Json
          domain: string
          id?: string
          kind: string
          page_key: string
          url: string
        }
        Update: {
          at?: string
          brand_id?: string
          competitor_id?: string
          created_at?: string
          detail?: Json
          domain?: string
          id?: string
          kind?: string
          page_key?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_page_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_page_events_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          brand_id: string
          created_at: string
          domain: string
          id: string
          name: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          domain?: string
          id?: string
          name: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          domain?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      content_shopping_checks: {
        Row: {
          bad: Json
          brand_id: string
          categories: number
          categories_linked: number
          checked_at: string
          draft_id: string
          needs_attention: boolean
          page_url: string | null
          products: number
          products_linked: number
          read_from: string
        }
        Insert: {
          bad?: Json
          brand_id: string
          categories?: number
          categories_linked?: number
          checked_at?: string
          draft_id: string
          page_url?: string | null
          products?: number
          products_linked?: number
          read_from: string
        }
        Update: {
          bad?: Json
          brand_id?: string
          categories?: number
          categories_linked?: number
          checked_at?: string
          draft_id?: string
          page_url?: string | null
          products?: number
          products_linked?: number
          read_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_shopping_checks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_shopping_checks_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: true
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_plan_marks: {
        Row: {
          brand_id: string
          hidden_at: string | null
          priority: boolean
          restore_status: string | null
          row_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_id: string
          hidden_at?: string | null
          priority?: boolean
          restore_status?: string | null
          row_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_id?: string
          hidden_at?: string | null
          priority?: boolean
          restore_status?: string | null
          row_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      content_rule_sets: {
        Row: {
          organization_id: string
          overrides: Json
          page_type: string
          site_type: string
          text_rules: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          organization_id: string
          overrides?: Json
          page_type: string
          site_type: string
          text_rules?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          organization_id?: string
          overrides?: Json
          page_type?: string
          site_type?: string
          text_rules?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      content_drafts: {
        Row: {
          action_id: string | null
          agent_run: string | null
          agent_state: string | null
          agent_state_at: string | null
          quality_handoff: boolean
          archived_at: string | null
          archived_by: string | null
          author: string
          author_id: string | null
          author_profile_at: string | null
          author_profile_by: string | null
          author_real_at: string | null
          author_real_by: string | null
          body_html: string
          brief: Json | null
          brand_id: string
          conversation_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kept_sources: string[]
          method: string
          meta_description: string | null
          meta_title: string | null
          opportunity_id: string | null
          origin: string
          page_type: string | null
          page_type_source: string
          prompt_ids: string[]
          published_at: string | null
          published_url: string | null
          restored_at: string | null
          reviewer_id: string | null
          rules: Json | null
          schema_left_out: boolean
          source_url: string | null
          score_after: number | null
          score_before: number | null
          shopping_path: Json | null
          slug: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_id?: string | null
          agent_run?: string | null
          agent_state?: string | null
          agent_state_at?: string | null
          quality_handoff?: boolean
          archived_at?: string | null
          archived_by?: string | null
          author?: string
          author_id?: string | null
          author_profile_at?: string | null
          author_profile_by?: string | null
          author_real_at?: string | null
          author_real_by?: string | null
          body_html?: string
          brief?: Json | null
          brand_id: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kept_sources?: string[]
          method?: string
          meta_description?: string | null
          meta_title?: string | null
          opportunity_id?: string | null
          origin?: string
          page_type?: string | null
          page_type_source?: string
          prompt_ids?: string[]
          published_at?: string | null
          published_url?: string | null
          restored_at?: string | null
          reviewer_id?: string | null
          rules?: Json | null
          schema_left_out?: boolean
          source_url?: string | null
          score_after?: number | null
          score_before?: number | null
          shopping_path?: Json | null
          slug?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          action_id?: string | null
          agent_run?: string | null
          agent_state?: string | null
          agent_state_at?: string | null
          quality_handoff?: boolean
          archived_at?: string | null
          archived_by?: string | null
          author?: string
          author_id?: string | null
          author_profile_at?: string | null
          author_profile_by?: string | null
          author_real_at?: string | null
          author_real_by?: string | null
          body_html?: string
          brief?: Json | null
          brand_id?: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kept_sources?: string[]
          method?: string
          meta_description?: string | null
          meta_title?: string | null
          opportunity_id?: string | null
          origin?: string
          page_type?: string | null
          page_type_source?: string
          prompt_ids?: string[]
          published_at?: string | null
          published_url?: string | null
          restored_at?: string | null
          reviewer_id?: string | null
          rules?: Json | null
          schema_left_out?: boolean
          source_url?: string | null
          score_after?: number | null
          score_before?: number | null
          shopping_path?: Json | null
          slug?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_drafts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "content_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "content_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_drafts_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
        ]
      }
      content_author_defaults: {
        Row: {
          author_id: string
          brand_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          author_id: string
          brand_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          author_id?: string
          brand_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_author_defaults_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "content_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_author_defaults_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      content_authors: {
        Row: {
          bio: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          photo_url: string | null
          same_as: string[]
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          photo_url?: string | null
          same_as?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          photo_url?: string | null
          same_as?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_authors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_agent_runs: {
        Row: {
          claimed_at: string | null
          draft_id: string
          finished_at: string | null
          id: string
          kind: string
          origin: string
          outcome: string | null
          started_at: string
          step: number
          steps: Json
          stopped_at: string | null
        }
        Insert: {
          claimed_at?: string | null
          draft_id: string
          finished_at?: string | null
          id?: string
          kind: string
          origin?: string
          outcome?: string | null
          started_at?: string
          step?: number
          steps: Json
          stopped_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          draft_id?: string
          finished_at?: string | null
          id?: string
          kind?: string
          origin?: string
          outcome?: string | null
          started_at?: string
          step?: number
          steps?: Json
          stopped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_agent_runs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_confirmations: {
        Row: {
          confirmed_at: string
          confirmed_by: string | null
          draft_id: string
          key: string
          kind: string
        }
        Insert: {
          confirmed_at?: string
          confirmed_by?: string | null
          draft_id: string
          key: string
          kind: string
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string | null
          draft_id?: string
          key?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_confirmations_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_confirmations_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_deliveries: {
        Row: {
          agent_run_id: string | null
          batch_id: string | null
          brand_id: string
          created_at: string
          draft_id: string | null
          error: string | null
          external_id: string | null
          http_status: number | null
          id: string
          organization_id: string
          published_at: string | null
          published_url: string | null
          response_excerpt: string | null
          sent_at: string | null
          sent_by: string | null
          slug: string | null
          status: string
          target: string
          target_collection: string | null
          title: string
        }
        Insert: {
          agent_run_id?: string | null
          batch_id?: string | null
          brand_id: string
          created_at?: string
          draft_id?: string | null
          error?: string | null
          external_id?: string | null
          http_status?: number | null
          id?: string
          organization_id: string
          published_at?: string | null
          published_url?: string | null
          response_excerpt?: string | null
          sent_at?: string | null
          sent_by?: string | null
          slug?: string | null
          status?: string
          target?: string
          target_collection?: string | null
          title: string
        }
        Update: {
          agent_run_id?: string | null
          batch_id?: string | null
          brand_id?: string
          created_at?: string
          draft_id?: string | null
          error?: string | null
          external_id?: string | null
          http_status?: number | null
          id?: string
          organization_id?: string
          published_at?: string | null
          published_url?: string | null
          response_excerpt?: string | null
          sent_at?: string | null
          sent_by?: string | null
          slug?: string | null
          status?: string
          target?: string
          target_collection?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_deliveries_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_deliveries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_deliveries_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_deliveries_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_inputs: {
        Row: {
          getcito_data: Json
          data: Json
          draft_id: string
          experience: string | null
          quotes: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          getcito_data?: Json
          data?: Json
          draft_id: string
          experience?: string | null
          quotes?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          getcito_data?: Json
          data?: Json
          draft_id?: string
          experience?: string | null
          quotes?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_inputs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: true
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_own_images: {
        Row: {
          confirmed_at: string
          confirmed_by: string | null
          draft_id: string
          src: string
        }
        Insert: {
          confirmed_at?: string
          confirmed_by?: string | null
          draft_id: string
          src: string
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string | null
          draft_id?: string
          src?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_own_images_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_own_images_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_ready_log: {
        Row: {
          created_at: string
          created_by: string | null
          draft_id: string
          id: string
          reason: string | null
          reason_count: number | null
          trust: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          draft_id: string
          id?: string
          reason?: string | null
          reason_count?: number | null
          trust: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          draft_id?: string
          id?: string
          reason?: string | null
          reason_count?: number | null
          trust?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_ready_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_ready_log_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_sources: {
        Row: {
          added: boolean
          created_at: string
          draft_id: string
          included: boolean
          kind: string
          ref: string
          updated_at: string
        }
        Insert: {
          added?: boolean
          created_at?: string
          draft_id: string
          included?: boolean
          kind: string
          ref: string
          updated_at?: string
        }
        Update: {
          added?: boolean
          created_at?: string
          draft_id?: string
          included?: boolean
          kind?: string
          ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_sources_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_suggestions: {
        Row: {
          action_id: string | null
          after_chars: number | null
          after_links: Json | null
          after_text: string
          agent: string
          batch_id: string
          before_html: string | null
          before_text: string
          block_text: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          draft_id: string
          id: string
          kept_chars: number | null
          kind: string
          length_target: number | null
          position: number
          reason: string
          rule_keys: string[]
          source_marks: Json | null
          sources: Json | null
          status: string
        }
        Insert: {
          action_id?: string | null
          after_chars?: number | null
          after_links?: Json | null
          after_text: string
          agent?: string
          batch_id: string
          before_html?: string | null
          before_text?: string
          block_text: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          draft_id: string
          id?: string
          kept_chars?: number | null
          kind: string
          length_target?: number | null
          position?: number
          reason: string
          rule_keys?: string[]
          source_marks?: Json | null
          sources?: Json | null
          status?: string
        }
        Update: {
          action_id?: string | null
          after_chars?: number | null
          after_links?: Json | null
          after_text?: string
          agent?: string
          batch_id?: string
          before_html?: string | null
          before_text?: string
          block_text?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          draft_id?: string
          id?: string
          kept_chars?: number | null
          kind?: string
          length_target?: number | null
          position?: number
          reason?: string
          rule_keys?: string[]
          source_marks?: Json | null
          sources?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_suggestions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_suggestions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_suggestions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_draft_versions: {
        Row: {
          body_html: string
          created_at: string
          created_by: string | null
          draft_id: string
          id: string
          origin: string
          title: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          created_by?: string | null
          draft_id: string
          id?: string
          origin: string
          title?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          created_by?: string | null
          draft_id?: string
          id?: string
          origin?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_draft_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_draft_versions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_opportunities: {
        Row: {
          brand_id: string
          brief: Json | null
          cluster_id: string | null
          created_at: string | null
          decision: string | null
          description: string | null
          id: string
          impact: string
          opportunity_score: number | null
          prompt_id: string | null
          related_cluster_ids: string[]
          source_data: Json | null
          status: string
          title: string
          type: string
          updated_at: string | null
          webhook_response: Json | null
          webhook_sent_at: string | null
        }
        Insert: {
          brand_id: string
          brief?: Json | null
          cluster_id?: string | null
          created_at?: string | null
          decision?: string | null
          description?: string | null
          id?: string
          impact?: string
          opportunity_score?: number | null
          prompt_id?: string | null
          related_cluster_ids?: string[]
          source_data?: Json | null
          status?: string
          title: string
          type?: string
          updated_at?: string | null
          webhook_response?: Json | null
          webhook_sent_at?: string | null
        }
        Update: {
          brand_id?: string
          brief?: Json | null
          cluster_id?: string | null
          created_at?: string | null
          decision?: string | null
          description?: string | null
          id?: string
          impact?: string
          opportunity_score?: number | null
          prompt_id?: string | null
          related_cluster_ids?: string[]
          source_data?: Json | null
          status?: string
          title?: string
          type?: string
          updated_at?: string | null
          webhook_response?: Json | null
          webhook_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_opportunities_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      dataforseo_competition_cache: {
        Row: {
          competition: string | null
          competition_index: number | null
          fetched_at: string
          keyword: string
          language_code: string
          location_code: number
        }
        Insert: {
          competition?: string | null
          competition_index?: number | null
          fetched_at?: string
          keyword: string
          language_code?: string
          location_code?: number
        }
        Update: {
          competition?: string | null
          competition_index?: number | null
          fetched_at?: string
          keyword?: string
          language_code?: string
          location_code?: number
        }
        Relationships: []
      }
      fanout_query_intents: {
        Row: {
          created_at: string
          intent: string
          query: string
        }
        Insert: {
          created_at?: string
          intent: string
          query: string
        }
        Update: {
          created_at?: string
          intent?: string
          query?: string
        }
        Relationships: []
      }
      ga_ai_traffic_stats: {
        Row: {
          brand_id: string
          created_at: string
          date: string
          engaged_sessions: number
          engagement_duration_seconds: number
          id: string
          key_events: number
          landing_page: string
          landing_page_query: string
          platform: string | null
          purchase_revenue: number
          sessions: number
          source: string
          total_users: number
          transactions: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          date: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          landing_page_query?: string
          platform?: string | null
          purchase_revenue?: number
          sessions?: number
          source: string
          total_users?: number
          transactions?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          date?: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          landing_page_query?: string
          platform?: string | null
          purchase_revenue?: number
          sessions?: number
          source?: string
          total_users?: number
          transactions?: number
        }
        Relationships: [
          {
            foreignKeyName: "ga_ai_traffic_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ga_item_stats: {
        Row: {
          brand_id: string
          created_at: string
          date: string
          id: string
          item_category: string
          item_id: string
          item_name: string
          item_revenue: number
          items_added_to_cart: number
          items_purchased: number
          items_viewed: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          date: string
          id?: string
          item_category?: string
          item_id?: string
          item_name?: string
          item_revenue?: number
          items_added_to_cart?: number
          items_purchased?: number
          items_viewed?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          date?: string
          id?: string
          item_category?: string
          item_id?: string
          item_name?: string
          item_revenue?: number
          items_added_to_cart?: number
          items_purchased?: number
          items_viewed?: number
        }
        Relationships: [
          {
            foreignKeyName: "ga_item_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ga_page_stats: {
        Row: {
          brand_id: string
          created_at: string
          date: string
          engaged_sessions: number
          engagement_duration_seconds: number
          id: string
          key_events: number
          landing_page: string
          purchase_revenue: number
          sessions: number
          total_users: number
          transactions: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          date: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          purchase_revenue?: number
          sessions?: number
          total_users?: number
          transactions?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          date?: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          purchase_revenue?: number
          sessions?: number
          total_users?: number
          transactions?: number
        }
        Relationships: [
          {
            foreignKeyName: "ga_page_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      getting_started: {
        Row: {
          brand_id: string
          confirmed_at: string | null
          dismissed_at: string | null
          started_at: string
        }
        Insert: {
          brand_id: string
          confirmed_at?: string | null
          dismissed_at?: string | null
          started_at?: string
        }
        Update: {
          brand_id?: string
          confirmed_at?: string | null
          dismissed_at?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "getting_started_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      getting_started_steps: {
        Row: {
          brand_id: string
          state: string
          step: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          state: string
          step: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          state?: string
          step?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "getting_started_steps_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_page_stats: {
        Row: {
          brand_id: string
          clicks: number
          created_at: string
          ctr: number
          date: string
          id: string
          impressions: number
          page: string
          page_key: string | null
          position: number
        }
        Insert: {
          brand_id: string
          clicks?: number
          created_at?: string
          ctr?: number
          date: string
          id?: string
          impressions?: number
          page: string
          page_key?: never
          position?: number
        }
        Update: {
          brand_id?: string
          clicks?: number
          created_at?: string
          ctr?: number
          date?: string
          id?: string
          impressions?: number
          page?: string
          page_key?: never
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "gsc_page_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_shopping_page_stats: {
        Row: {
          appearance: string
          brand_id: string
          clicks: number
          created_at: string
          ctr: number
          date: string
          id: string
          impressions: number
          page: string
          position: number
        }
        Insert: {
          appearance: string
          brand_id: string
          clicks?: number
          created_at?: string
          ctr?: number
          date: string
          id?: string
          impressions?: number
          page: string
          position?: number
        }
        Update: {
          appearance?: string
          brand_id?: string
          clicks?: number
          created_at?: string
          ctr?: number
          date?: string
          id?: string
          impressions?: number
          page?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "gsc_shopping_page_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_query_stats: {
        Row: {
          brand_id: string
          clicks: number
          created_at: string
          ctr: number
          date: string
          id: string
          impressions: number
          position: number
          query: string
        }
        Insert: {
          brand_id: string
          clicks?: number
          created_at?: string
          ctr?: number
          date: string
          id?: string
          impressions?: number
          position?: number
          query: string
        }
        Update: {
          brand_id?: string
          clicks?: number
          created_at?: string
          ctr?: number
          date?: string
          id?: string
          impressions?: number
          position?: number
          query?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_query_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      help_answer_cache: {
        Row: {
          answer_md: string
          app_version: string
          articles: string[]
          created_at: string
          hits: number
          id: string
          lang: string
          last_hit_at: string | null
          model: string | null
          question: string
          question_hash: string
        }
        Insert: {
          answer_md: string
          app_version: string
          articles?: string[]
          created_at?: string
          hits?: number
          id?: string
          lang: string
          last_hit_at?: string | null
          model?: string | null
          question: string
          question_hash: string
        }
        Update: {
          answer_md?: string
          app_version?: string
          articles?: string[]
          created_at?: string
          hits?: number
          id?: string
          lang?: string
          last_hit_at?: string | null
          model?: string | null
          question?: string
          question_hash?: string
        }
        Relationships: []
      }
      help_gaps: {
        Row: {
          app_version: string | null
          best_article: string | null
          best_score: number | null
          created_at: string
          id: string
          lang: string
          question: string
          route: string | null
        }
        Insert: {
          app_version?: string | null
          best_article?: string | null
          best_score?: number | null
          created_at?: string
          id?: string
          lang: string
          question: string
          route?: string | null
        }
        Update: {
          app_version?: string | null
          best_article?: string | null
          best_score?: number | null
          created_at?: string
          id?: string
          lang?: string
          question?: string
          route?: string | null
        }
        Relationships: []
      }
      impact_control_sets: {
        Row: {
          cell_count: number
          checkpoint: string
          created_at: string
          entities: Json
          id: string
          impact_measurement_id: string
          match_rules_json: Json
        }
        Insert: {
          cell_count?: number
          checkpoint: string
          created_at?: string
          entities?: Json
          id?: string
          impact_measurement_id: string
          match_rules_json?: Json
        }
        Update: {
          cell_count?: number
          checkpoint?: string
          created_at?: string
          entities?: Json
          id?: string
          impact_measurement_id?: string
          match_rules_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "impact_control_sets_impact_measurement_id_fkey"
            columns: ["impact_measurement_id"]
            isOneToOne: false
            referencedRelation: "impact_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      impact_measurements: {
        Row: {
          checkpoint: string | null
          checkpoints_json: Json
          concurrent_changes: Json
          confidence: string | null
          created_at: string
          id: string
          measured_at: string | null
          metrics: Json
          next_check_at: string | null
          not_measurable_reason: string | null
          outcome: string
          ship_event_id: string
          targets: Json
          updated_at: string
          window_json: Json
        }
        Insert: {
          checkpoint?: string | null
          checkpoints_json?: Json
          concurrent_changes?: Json
          confidence?: string | null
          created_at?: string
          id?: string
          measured_at?: string | null
          metrics?: Json
          next_check_at?: string | null
          not_measurable_reason?: string | null
          outcome?: string
          ship_event_id: string
          targets?: Json
          updated_at?: string
          window_json?: Json
        }
        Update: {
          checkpoint?: string | null
          checkpoints_json?: Json
          concurrent_changes?: Json
          confidence?: string | null
          created_at?: string
          id?: string
          measured_at?: string | null
          metrics?: Json
          next_check_at?: string | null
          not_measurable_reason?: string | null
          outcome?: string
          ship_event_id?: string
          targets?: Json
          updated_at?: string
          window_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "impact_measurements_ship_event_id_fkey"
            columns: ["ship_event_id"]
            isOneToOne: true
            referencedRelation: "ship_events"
            referencedColumns: ["id"]
          },
        ]
      }
      insights_brand_daily: {
        Row: {
          answer_count: number
          brand_id: string
          citation_answers: number
          day: string
          max_created_at: string
          mention_answers: number
          mentioning_answers: number
          model_used: string | null
          platform: string | null
          position_count: number
          positive_count: number
          region: string | null
          sum_inv_position: number | null
          sum_visibility: number
          sum_visibility_visible: number
          total_citations: number
          total_mentions: number
        }
        Insert: {
          answer_count: number
          brand_id: string
          citation_answers: number
          day: string
          max_created_at: string
          mention_answers: number
          mentioning_answers: number
          model_used?: string | null
          platform?: string | null
          position_count: number
          positive_count: number
          region?: string | null
          sum_inv_position?: number | null
          sum_visibility: number
          sum_visibility_visible: number
          total_citations: number
          total_mentions: number
        }
        Update: {
          answer_count?: number
          brand_id?: string
          citation_answers?: number
          day?: string
          max_created_at?: string
          mention_answers?: number
          mentioning_answers?: number
          model_used?: string | null
          platform?: string | null
          position_count?: number
          positive_count?: number
          region?: string | null
          sum_inv_position?: number | null
          sum_visibility?: number
          sum_visibility_visible?: number
          total_citations?: number
          total_mentions?: number
        }
        Relationships: [
          {
            foreignKeyName: "insights_brand_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      insights_competitor_daily: {
        Row: {
          answer_count: number
          brand_id: string
          citation_answers: number
          competitor_id: string
          day: string
          mention_answers: number
          model_used: string | null
          platform: string | null
          position_count: number
          region: string | null
          sum_inv_position: number | null
          sum_visibility: number | null
          total_citations: number
          total_mentions: number
        }
        Insert: {
          answer_count: number
          brand_id: string
          citation_answers: number
          competitor_id: string
          day: string
          mention_answers: number
          model_used?: string | null
          platform?: string | null
          position_count: number
          region?: string | null
          sum_inv_position?: number | null
          sum_visibility?: number | null
          total_citations: number
          total_mentions: number
        }
        Update: {
          answer_count?: number
          brand_id?: string
          citation_answers?: number
          competitor_id?: string
          day?: string
          mention_answers?: number
          model_used?: string | null
          platform?: string | null
          position_count?: number
          region?: string | null
          sum_inv_position?: number | null
          sum_visibility?: number | null
          total_citations?: number
          total_mentions?: number
        }
        Relationships: [
          {
            foreignKeyName: "insights_competitor_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      insights_competitor_prompt_daily: {
        Row: {
          brand_id: string
          competitor_id: string
          day: string
          model_used: string | null
          platform: string | null
          prompt_id: string
          region: string | null
        }
        Insert: {
          brand_id: string
          competitor_id: string
          day: string
          model_used?: string | null
          platform?: string | null
          prompt_id: string
          region?: string | null
        }
        Update: {
          brand_id?: string
          competitor_id?: string
          day?: string
          model_used?: string | null
          platform?: string | null
          prompt_id?: string
          region?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insights_competitor_prompt_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      insights_prompt_daily: {
        Row: {
          answer_count: number
          brand_id: string
          day: string
          has_citation: boolean
          has_mention: boolean
          model_used: string | null
          platform: string | null
          prompt_id: string
          region: string | null
        }
        Insert: {
          answer_count: number
          brand_id: string
          day: string
          has_citation: boolean
          has_mention: boolean
          model_used?: string | null
          platform?: string | null
          prompt_id: string
          region?: string | null
        }
        Update: {
          answer_count?: number
          brand_id?: string
          day?: string
          has_citation?: boolean
          has_mention?: boolean
          model_used?: string | null
          platform?: string | null
          prompt_id?: string
          region?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insights_prompt_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_accounts: {
        Row: {
          cms_connection_id: string | null
          composio_account_id: string | null
          composio_entity_id: string | null
          connected_by: string | null
          created_at: string
          id: string
          integration_connection_id: string | null
          label: string | null
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          cms_connection_id?: string | null
          composio_account_id?: string | null
          composio_entity_id?: string | null
          connected_by?: string | null
          created_at?: string
          id?: string
          integration_connection_id?: string | null
          label?: string | null
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          cms_connection_id?: string | null
          composio_account_id?: string | null
          composio_entity_id?: string | null
          connected_by?: string | null
          created_at?: string
          id?: string
          integration_connection_id?: string | null
          label?: string | null
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_accounts_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_accounts_integration_connection_id_fkey"
            columns: ["integration_connection_id"]
            isOneToOne: true
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          composio_account_id: string | null
          composio_entity_id: string
          connected_by: string | null
          created_at: string
          id: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          composio_account_id?: string | null
          composio_entity_id: string
          connected_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          composio_account_id?: string | null
          composio_entity_id?: string
          connected_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          brand_ids: string[]
          brand_scope: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          brand_ids?: string[]
          brand_scope?: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          brand_ids?: string[]
          brand_scope?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          brand_id: string
          completed_at: string | null
          created_at: string
          data: Json
          failed_reason: string | null
          id: string
          max_attempts: number
          progress: Json | null
          result: Json | null
          started_at: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          brand_id: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          failed_reason?: string | null
          id?: string
          max_attempts?: number
          progress?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          brand_id?: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          failed_reason?: string | null
          id?: string
          max_attempts?: number
          progress?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_definitions: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          is_active: boolean
          kpi_key: string
          target: number
          timeframe: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          kpi_key: string
          target: number
          timeframe?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kpi_key?: string
          target?: number
          timeframe?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_definitions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      member_brands: {
        Row: {
          brand_id: string
          granted_at: string
          granted_by: string | null
          organization_id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          granted_at?: string
          granted_by?: string | null
          organization_id: string
          user_id: string
        }
        Update: {
          brand_id?: string
          granted_at?: string
          granted_by?: string | null
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_brands_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_ai_keys: {
        Row: {
          active: boolean
          checked_at: string | null
          failing_since: string | null
          failure_class: string | null
          failure_status: number | null
          key_encrypted: string
          key_last4: string
          notified_at: string | null
          organization_id: string
          provider: string
          set_at: string
          set_by: string | null
          settings: Json
        }
        Insert: {
          active?: boolean
          checked_at?: string | null
          failing_since?: string | null
          failure_class?: string | null
          failure_status?: number | null
          key_encrypted: string
          key_last4: string
          notified_at?: string | null
          organization_id: string
          provider: string
          set_at?: string
          set_by?: string | null
          settings?: Json
        }
        Update: {
          active?: boolean
          checked_at?: string | null
          failing_since?: string | null
          failure_class?: string | null
          failure_status?: number | null
          key_encrypted?: string
          key_last4?: string
          notified_at?: string | null
          organization_id?: string
          provider?: string
          set_at?: string
          set_by?: string | null
          settings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "organization_ai_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_ai_keys_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_menu_roles: {
        Row: {
          hidden_sections: string[]
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          hidden_sections?: string[]
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          hidden_sections?: string[]
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_menu_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          anthropic_api_key_encrypted: string | null
          anthropic_api_key_last4: string | null
          anthropic_api_key_set_at: string | null
          anthropic_api_key_set_by: string | null
          cancel_at_period_end: boolean
          created_at: string
          id: string
          legacy_key_grandfathered: boolean
          legacy_key_until: string | null
          name: string
          plan: string
          plan_overrides: Json | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          anthropic_api_key_encrypted?: string | null
          anthropic_api_key_last4?: string | null
          anthropic_api_key_set_at?: string | null
          anthropic_api_key_set_by?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          id?: string
          legacy_key_grandfathered?: boolean
          legacy_key_until?: string | null
          name: string
          plan?: string
          plan_overrides?: Json | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          anthropic_api_key_encrypted?: string | null
          anthropic_api_key_last4?: string | null
          anthropic_api_key_set_at?: string | null
          anthropic_api_key_set_by?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          id?: string
          legacy_key_grandfathered?: boolean
          legacy_key_until?: string | null
          name?: string
          plan?: string
          plan_overrides?: Json | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_anthropic_api_key_set_by_fkey"
            columns: ["anthropic_api_key_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_opportunities: {
        Row: {
          ai_platforms: string[]
          ai_sessions: number
          brand_id: string
          citation_state: string | null
          citations: number
          citing_prompts: number
          engaged_sessions: number
          engagement_seconds: number
          first_detected_at: string
          id: string
          key_events: number
          kind: string
          landing_page: string
          last_detected_at: string
          resolved_at: string | null
          revenue: number
          sessions: number
          targeting_prompts: number
          transactions: number
          value_percentile: number
          value_rank: number
          value_signal: string
          window_days: number
        }
        Insert: {
          ai_platforms?: string[]
          ai_sessions?: number
          brand_id: string
          citation_state?: string | null
          citations?: number
          citing_prompts?: number
          engaged_sessions?: number
          engagement_seconds?: number
          first_detected_at?: string
          id?: string
          key_events?: number
          kind: string
          landing_page: string
          last_detected_at?: string
          resolved_at?: string | null
          revenue?: number
          sessions?: number
          targeting_prompts?: number
          transactions?: number
          value_percentile: number
          value_rank: number
          value_signal: string
          window_days: number
        }
        Update: {
          ai_platforms?: string[]
          ai_sessions?: number
          brand_id?: string
          citation_state?: string | null
          citations?: number
          citing_prompts?: number
          engaged_sessions?: number
          engagement_seconds?: number
          first_detected_at?: string
          id?: string
          key_events?: number
          kind?: string
          landing_page?: string
          last_detected_at?: string
          resolved_at?: string | null
          revenue?: number
          sessions?: number
          targeting_prompts?: number
          transactions?: number
          value_percentile?: number
          value_rank?: number
          value_signal?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_opportunities_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          brand_scope: string
          can_manage_menus: boolean
          created_at: string
          full_name: string | null
          id: string
          menu_hidden: string[]
          menu_shown: string[]
          onboarding_completed: boolean | null
          organization_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          work_areas: string[]
          work_areas_asked_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          brand_scope?: string
          can_manage_menus?: boolean
          created_at?: string
          full_name?: string | null
          id: string
          menu_hidden?: string[]
          menu_shown?: string[]
          onboarding_completed?: boolean | null
          organization_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          work_areas?: string[]
          work_areas_asked_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          brand_scope?: string
          can_manage_menus?: boolean
          created_at?: string
          full_name?: string | null
          id?: string
          menu_hidden?: string[]
          menu_shown?: string[]
          onboarding_completed?: boolean | null
          organization_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          work_areas?: string[]
          work_areas_asked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_cluster_members: {
        Row: {
          cluster_id: string
          prompt_id: string
        }
        Insert: {
          cluster_id: string
          prompt_id: string
        }
        Update: {
          cluster_id?: string
          prompt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_cluster_members_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: true
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          prompt_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          prompt_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          prompt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_notes_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_result_citations: {
        Row: {
          brand_id: string
          created_at: string
          position: number
          prompt_result_id: string
          url_id: number
        }
        Insert: {
          brand_id: string
          created_at: string
          position: number
          prompt_result_id: string
          url_id: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          position?: number
          prompt_result_id?: string
          url_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_result_citations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_result_citations_prompt_result_id_fkey"
            columns: ["prompt_result_id"]
            isOneToOne: false
            referencedRelation: "prompt_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_result_citations_url_id_fkey"
            columns: ["url_id"]
            isOneToOne: false
            referencedRelation: "citation_urls"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_result_shopping_cards: {
        Row: {
          brand_id: string
          catalog_match: string | null
          catalog_product_id: string | null
          created_at: string
          id: string
          image_url: string | null
          listing_id: string | null
          marketplace: string | null
          matched_brand_id: string | null
          matched_brand_role: string
          merchant_domain: string | null
          merchant_kind: string | null
          merchant_url: string | null
          platform: string
          position: number
          price_amount: number | null
          price_currency: string | null
          product_brand: string | null
          product_title: string | null
          prompt_result_id: string
          rating: number | null
          raw: Json
          region: string | null
          review_count: number | null
        }
        Insert: {
          brand_id: string
          catalog_match?: string | null
          catalog_product_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          listing_id?: string | null
          marketplace?: string | null
          matched_brand_id?: string | null
          matched_brand_role?: string
          merchant_domain?: string | null
          merchant_kind?: string | null
          merchant_url?: string | null
          platform: string
          position: number
          price_amount?: number | null
          price_currency?: string | null
          product_brand?: string | null
          product_title?: string | null
          prompt_result_id: string
          rating?: number | null
          raw: Json
          region?: string | null
          review_count?: number | null
        }
        Update: {
          brand_id?: string
          catalog_match?: string | null
          catalog_product_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          listing_id?: string | null
          marketplace?: string | null
          matched_brand_id?: string | null
          matched_brand_role?: string
          merchant_domain?: string | null
          merchant_kind?: string | null
          merchant_url?: string | null
          platform?: string
          position?: number
          price_amount?: number | null
          price_currency?: string | null
          product_brand?: string | null
          product_title?: string | null
          prompt_result_id?: string
          rating?: number | null
          raw?: Json
          region?: string | null
          review_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_result_shopping_cards_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_result_shopping_cards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_result_shopping_cards_prompt_result_id_fkey"
            columns: ["prompt_result_id"]
            isOneToOne: false
            referencedRelation: "prompt_results"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_results: {
        Row: {
          brand_id: string
          citation_count: number
          citations: Json
          competitor_mentions: Json
          created_at: string
          id: string
          inline_products: Json
          mention_count: number
          mention_position: number | null
          mentioned_entity_count: number | null
          model_used: string | null
          platform: string
          prompt_id: string
          region: string | null
          response: string
          search_queries: Json
          sentiment: string
          shopping_cards: Json
          visibility_score: number
        }
        Insert: {
          brand_id: string
          citation_count?: number
          citations?: Json
          competitor_mentions?: Json
          created_at?: string
          id?: string
          inline_products?: Json
          mention_count?: number
          mention_position?: number | null
          mentioned_entity_count?: number | null
          model_used?: string | null
          platform: string
          prompt_id: string
          region?: string | null
          response?: string
          search_queries?: Json
          sentiment?: string
          shopping_cards?: Json
          visibility_score?: number
        }
        Update: {
          brand_id?: string
          citation_count?: number
          citations?: Json
          competitor_mentions?: Json
          created_at?: string
          id?: string
          inline_products?: Json
          mention_count?: number
          mention_position?: number | null
          mentioned_entity_count?: number | null
          model_used?: string | null
          platform?: string
          prompt_id?: string
          region?: string | null
          response?: string
          search_queries?: Json
          sentiment?: string
          shopping_cards?: Json
          visibility_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_results_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_sets: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_sets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_suggestions: {
        Row: {
          added_prompt_id: string | null
          brand_id: string
          created_at: string
          est_volume: number | null
          expires_at: string
          generated_at: string
          id: string
          reason: string | null
          source: string
          source_data: Json | null
          status: string
          suggested_text: string
          topic_id: string | null
          topic_name: string | null
          updated_at: string
        }
        Insert: {
          added_prompt_id?: string | null
          brand_id: string
          created_at?: string
          est_volume?: number | null
          expires_at?: string
          generated_at?: string
          id?: string
          reason?: string | null
          source?: string
          source_data?: Json | null
          status?: string
          suggested_text: string
          topic_id?: string | null
          topic_name?: string | null
          updated_at?: string
        }
        Update: {
          added_prompt_id?: string | null
          brand_id?: string
          created_at?: string
          est_volume?: number | null
          expires_at?: string
          generated_at?: string
          id?: string
          reason?: string | null
          source?: string
          source_data?: Json | null
          status?: string
          suggested_text?: string
          topic_id?: string | null
          topic_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_suggestions_added_prompt_id_fkey"
            columns: ["added_prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_suggestions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_table_views: {
        Row: {
          brand_id: string
          columns: Json
          id: string
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          brand_id: string
          columns: Json
          id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          columns?: Json
          id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_table_views_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_target_urls: {
        Row: {
          added_by: string | null
          cited_count: number
          created_at: string
          first_cited_at: string | null
          id: string
          label: string | null
          last_cited_at: string | null
          prompt_id: string
          url: string
        }
        Insert: {
          added_by?: string | null
          cited_count?: number
          created_at?: string
          first_cited_at?: string | null
          id?: string
          label?: string | null
          last_cited_at?: string | null
          prompt_id: string
          url: string
        }
        Update: {
          added_by?: string | null
          cited_count?: number
          created_at?: string
          first_cited_at?: string | null
          id?: string
          label?: string | null
          last_cited_at?: string | null
          prompt_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_target_urls_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_target_urls_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_volumes: {
        Row: {
          ai_volume_multiplier: number
          competition: string | null
          competition_index: number | null
          created_at: string | null
          est_ai_volume: number
          fetched_at: string | null
          google_volumes: Json
          id: string
          intent: string
          keywords: Json
          language_code: string | null
          location_code: number | null
          prompt_id: string
          total_google_volume: number
        }
        Insert: {
          ai_volume_multiplier: number
          competition?: string | null
          competition_index?: number | null
          created_at?: string | null
          est_ai_volume: number
          fetched_at?: string | null
          google_volumes: Json
          id?: string
          intent: string
          keywords: Json
          language_code?: string | null
          location_code?: number | null
          prompt_id: string
          total_google_volume: number
        }
        Update: {
          ai_volume_multiplier?: number
          competition?: string | null
          competition_index?: number | null
          created_at?: string | null
          est_ai_volume?: number
          fetched_at?: string | null
          google_volumes?: Json
          id?: string
          intent?: string
          keywords?: Json
          language_code?: string | null
          location_code?: number | null
          prompt_id?: string
          total_google_volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_volumes_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: true
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          models: string[]
          platforms: string[]
          prompt_set_id: string
          regions: string[]
          text: string
          topic_id: string | null
          work_status: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          models?: string[]
          platforms?: string[]
          prompt_set_id: string
          regions?: string[]
          text: string
          topic_id?: string | null
          work_status?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          models?: string[]
          platforms?: string[]
          prompt_set_id?: string
          regions?: string[]
          text?: string
          topic_id?: string | null
          work_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_prompt_set_id_fkey"
            columns: ["prompt_set_id"]
            isOneToOne: false
            referencedRelation: "prompt_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_settings: {
        Row: {
          brand_id: string
          created_at: string
          frequency: string
          recipients: string[] | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          frequency?: string
          recipients?: string[] | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          frequency?: string
          recipients?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_settings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          date_from: string
          date_to: string
          id: string
          payload: Json
          template: string
          title: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          date_from: string
          date_to: string
          id?: string
          payload?: Json
          template?: string
          title: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          date_from?: string
          date_to?: string
          id?: string
          payload?: Json
          template?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sent_pulses: {
        Row: {
          brand_id: string
          created_at: string
          email_recipient_count: number
          email_sent: boolean
          frequency: string
          id: string
          payload: Json
          pulse_date: string
          warning_keys: string[]
          webhook_sent: boolean
        }
        Insert: {
          brand_id: string
          created_at?: string
          email_recipient_count?: number
          email_sent?: boolean
          frequency: string
          id?: string
          payload?: Json
          pulse_date: string
          warning_keys?: string[]
          webhook_sent?: boolean
        }
        Update: {
          brand_id?: string
          created_at?: string
          email_recipient_count?: number
          email_sent?: boolean
          frequency?: string
          id?: string
          payload?: Json
          pulse_date?: string
          warning_keys?: string[]
          webhook_sent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sent_pulses_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      mentions_answer_terms: {
        Row: {
          brand_id: string
          created_at: string
          entity: string
          platform: string
          prompt_id: string
          region: string | null
          result_id: string
          terms: string[]
        }
        Insert: {
          brand_id: string
          created_at: string
          entity: string
          platform: string
          prompt_id: string
          region?: string | null
          result_id: string
          terms?: string[]
        }
        Update: {
          brand_id?: string
          created_at?: string
          entity?: string
          platform?: string
          prompt_id?: string
          region?: string | null
          result_id?: string
          terms?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "mentions_answer_terms_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentions_answer_terms_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "prompt_results"
            referencedColumns: ["id"]
          },
        ]
      }
      mentions_entities_daily: {
        Row: {
          answers: number
          brand_id: string
          day: string
          entity: string
          platform: string
          region: string | null
          with_brand: number
        }
        Insert: {
          answers: number
          brand_id: string
          day: string
          entity: string
          platform: string
          region?: string | null
          with_brand: number
        }
        Update: {
          answers?: number
          brand_id?: string
          day?: string
          entity?: string
          platform?: string
          region?: string | null
          with_brand?: number
        }
        Relationships: [
          {
            foreignKeyName: "mentions_entities_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      mentions_terms_daily: {
        Row: {
          answers: number
          brand_id: string
          day: string
          entity: string
          platform: string
          region: string | null
          term: string
        }
        Insert: {
          answers: number
          brand_id: string
          day: string
          entity: string
          platform: string
          region?: string | null
          term: string
        }
        Update: {
          answers?: number
          brand_id?: string
          day?: string
          entity?: string
          platform?: string
          region?: string | null
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentions_terms_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      sentiment_overrides: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          note: string | null
          previous_sentiment: string
          result_id: string
          sentiment: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          note?: string | null
          previous_sentiment: string
          result_id: string
          sentiment: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          note?: string | null
          previous_sentiment?: string
          result_id?: string
          sentiment?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sentiment_overrides_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentiment_overrides_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "prompt_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentiment_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ship_events: {
        Row: {
          action_id: string | null
          agent_id: string | null
          agent_run_id: string | null
          brand_id: string
          change_type: string | null
          content_draft_delivery_id: string | null
          content_draft_id: string | null
          created_at: string
          execution_mode: string
          file_id: string | null
          id: string
          kind: string
          organization_id: string
          republished_at: string | null
          republished_delivery_ids: string[]
          run_id: string | null
          shipped_at: string
          shipped_by: string | null
          source: string
          title: string
          url: string | null
        }
        Insert: {
          action_id?: string | null
          agent_id?: string | null
          agent_run_id?: string | null
          brand_id: string
          change_type?: string | null
          content_draft_delivery_id?: string | null
          content_draft_id?: string | null
          created_at?: string
          execution_mode: string
          file_id?: string | null
          id?: string
          kind: string
          organization_id: string
          republished_at?: string | null
          republished_delivery_ids?: string[]
          run_id?: string | null
          shipped_at: string
          shipped_by?: string | null
          source: string
          title: string
          url?: string | null
        }
        Update: {
          action_id?: string | null
          agent_id?: string | null
          agent_run_id?: string | null
          brand_id?: string
          change_type?: string | null
          content_draft_delivery_id?: string | null
          content_draft_id?: string | null
          created_at?: string
          execution_mode?: string
          file_id?: string | null
          id?: string
          kind?: string
          organization_id?: string
          republished_at?: string | null
          republished_delivery_ids?: string[]
          run_id?: string | null
          shipped_at?: string
          shipped_by?: string | null
          source?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ship_events_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "chat_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "chat_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_content_draft_delivery_id_fkey"
            columns: ["content_draft_delivery_id"]
            isOneToOne: true
            referencedRelation: "content_draft_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_content_draft_id_fkey"
            columns: ["content_draft_id"]
            isOneToOne: false
            referencedRelation: "content_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "chat_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "chat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          action_id: string | null
          brand_id: string
          category: string
          change_value: number | null
          created_at: string
          current_value: number | null
          dedup_key: string
          detected_at: string
          id: string
          impact: string
          kind: string
          kpi_keys: string[]
          last_detected_at: string
          payload: Json
          previous_value: number | null
          resolved_at: string | null
          source: string[]
          status: string
          updated_at: string
        }
        Insert: {
          action_id?: string | null
          brand_id: string
          category: string
          change_value?: number | null
          created_at?: string
          current_value?: number | null
          dedup_key: string
          detected_at?: string
          id?: string
          impact: string
          kind: string
          kpi_keys?: string[]
          last_detected_at?: string
          payload?: Json
          previous_value?: number | null
          resolved_at?: string | null
          source?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          action_id?: string | null
          brand_id?: string
          category?: string
          change_value?: number | null
          created_at?: string
          current_value?: number | null
          dedup_key?: string
          detected_at?: string
          id?: string
          impact?: string
          kind?: string
          kpi_keys?: string[]
          last_detected_at?: string
          payload?: Json
          previous_value?: number | null
          resolved_at?: string | null
          source?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audit_usage: {
        Row: {
          audit_id: string | null
          created_at: string | null
          id: string
          organization_id: string
          used_at: string
        }
        Insert: {
          audit_id?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          used_at?: string
        }
        Update: {
          audit_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_audit_usage_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "site_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_audit_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audits: {
        Row: {
          brand_id: string
          category_scores: Json
          completed_at: string | null
          created_at: string
          error: string | null
          final_url: string | null
          id: string
          partial: boolean
          recommendations: Json
          rubric_version: string | null
          signals_evaluated: number | null
          signals_total: number | null
          status: string
          total_score: number | null
          url: string
        }
        Insert: {
          brand_id: string
          category_scores?: Json
          completed_at?: string | null
          created_at?: string
          error?: string | null
          final_url?: string | null
          id?: string
          partial?: boolean
          recommendations?: Json
          rubric_version?: string | null
          signals_evaluated?: number | null
          signals_total?: number | null
          status?: string
          total_score?: number | null
          url: string
        }
        Update: {
          brand_id?: string
          category_scores?: Json
          completed_at?: string | null
          created_at?: string
          error?: string | null
          final_url?: string | null
          id?: string
          partial?: boolean
          recommendations?: Json
          rubric_version?: string | null
          signals_evaluated?: number | null
          signals_total?: number | null
          status?: string
          total_score?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_audits_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_grants: {
        Row: {
          active_until: string
          bytes: number
          created_at: string
          id: string
          organization_id: string
          purchase_id: string
          updated_at: string
        }
        Insert: {
          active_until: string
          bytes: number
          created_at?: string
          id?: string
          organization_id: string
          purchase_id: string
          updated_at?: string
        }
        Update: {
          active_until?: string
          bytes?: number
          created_at?: string
          id?: string
          organization_id?: string
          purchase_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_grants_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: true
            referencedRelation: "add_on_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_suggestions: {
        Row: {
          added_topic_id: string | null
          brand_id: string
          created_at: string
          generated_at: string
          id: string
          name: string
          reason: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          added_topic_id?: string | null
          brand_id: string
          created_at?: string
          generated_at?: string
          id?: string
          name: string
          reason?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          added_topic_id?: string | null
          brand_id?: string
          created_at?: string
          generated_at?: string
          id?: string
          name?: string
          reason?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_suggestions_added_topic_id_fkey"
            columns: ["added_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          brand_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          brand_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          brand_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_runs: {
        Row: {
          brand_id: string
          completed_at: string | null
          created_at: string
          id: string
          result_count: number | null
          source: string
          started_at: string
        }
        Insert: {
          brand_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          result_count?: number | null
          source?: string
          started_at?: string
        }
        Update: {
          brand_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          result_count?: number | null
          source?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      volume_usage: {
        Row: {
          action: string
          created_at: string | null
          id: string
          organization_id: string
          prompt_count: number | null
          used_at: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          organization_id: string
          prompt_count?: number | null
          used_at?: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          organization_id?: string
          prompt_count?: number | null
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "volume_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_configs: {
        Row: {
          brand_id: string
          created_at: string | null
          events: string[] | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          webhook_secret: string | null
          webhook_url: string
        }
        Insert: {
          brand_id: string
          created_at?: string | null
          events?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          webhook_secret?: string | null
          webhook_url: string
        }
        Update: {
          brand_id?: string
          created_at?: string | null
          events?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          webhook_secret?: string | null
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_configs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      white_label_kits: {
        Row: {
          accent_color: string | null
          company_name: string | null
          created_at: string
          footer_text: string | null
          logo_path: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accent_color?: string | null
          company_name?: string | null
          created_at?: string
          footer_text?: string | null
          logo_path?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accent_color?: string | null
          company_name?: string | null
          created_at?: string
          footer_text?: string | null
          logo_path?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "white_label_kits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      action_entity_counts: {
        Args: { p_action_ids: string[] }
        Returns: {
          action_id: string
          entity_type: string
          removed: number
          removed_keys: string[]
          removed_labels: string[]
          total: number
        }[]
      }
      action_scorecard: {
        Args: { p_brand_id: string; p_since?: string | null }
        Returns: {
          completed: number
          declined: number
          dismiss_reasons: Json
          dismissed: number
          final: number
          improved: number
          kind: string
          median_change: number | null
          mixed: number
          no_change: number
          not_measurable: number
          pending: number
        }[]
      }
      ai_traffic_merged: {
        Args: {
          p_analytics?: boolean
          p_brand_id: string
          p_from: string | null
          p_to: string | null
          p_to_inclusive?: boolean
        }
        Returns: Json
      }
      ai_traffic_page_citations: {
        Args: { p_brand_id: string; p_since: string | null; p_until: string | null }
        Returns: {
          citations: number
          page: string
          page_key: string
        }[]
      }
      ai_traffic_pages: {
        Args: {
          p_brand_id: string
          p_from: string | null
          p_limit?: number
          p_offset?: number
          p_tab?: string
          p_to: string | null
        }
        Returns: Json
      }
      ai_bot_report: {
        Args: {
          p_brand_id: string
          p_limit?: number
          p_since: string | null
          p_until: string
        }
        Returns: Json
      }
      ai_traffic_broken_links: {
        Args: {
          p_brand_id: string
          p_from: string | null
          p_limit?: number
          p_offset?: number
          p_to: string | null
        }
        Returns: Json
      }
      ai_traffic_conversions: {
        Args: {
          p_brand_id: string
          p_limit?: number | null
          p_since: string | null
          p_until: string | null
        }
        Returns: Json
      }
      ai_traffic_google_pages: {
        Args: {
          p_brand_id: string
          p_latest?: boolean
          p_limit?: number
          p_min_impressions?: number
          p_since: string | null
          p_until: string
        }
        Returns: Json
      }
      ai_traffic_google_trend: {
        Args: {
          p_brand_id: string
          p_since: string
          p_until: string
        }
        Returns: Json
      }
      ai_visibility_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      ai_visibility_aggregates_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      apply_prompt_locations: { Args: { p_updates: Json }; Returns: number }
      approve_action_task_review: {
        Args: {
          p_details: Json
          p_review_id: string
          p_title: string
          p_user_id?: string
        }
        Returns: string
      }
      brand_ai_conversions: {
        Args: { p_brand_id: string; p_days?: number }
        Returns: Json
      }
      can_access_brand: {
        Args: { p_brand_id: string; p_user_id?: string }
        Returns: boolean
      }
      can_see_chat_agent: { Args: { p_agent_id: string }; Returns: boolean }
      chat_agent_usage_shares: {
        Args: { p_budget: number; p_organization_id: string; p_since: string }
        Returns: {
          agent_id: string
          own_key_share: number
          runs: number
          share: number
        }[]
      }
      chat_ask_options_valid: {
        Args: { p_options: Json }
        Returns: boolean
      }
      chat_claim_run_slot: {
        Args: { p_run_id: string; p_user_limit: number; p_workspace_limit: number }
        Returns: boolean
      }
      chat_note_touched_brands: {
        Args: {
          p_brand_ids: string[]
          p_conversation_id: string
          p_whole_workspace?: boolean
        }
        Returns: undefined
      }
      chat_run_limits: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: Json
      }
      chat_start_next_agent_run: {
        Args: { p_organization_id: string; p_workspace_limit: number }
        Returns: string
      }
      chat_start_touched_brands: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      chat_text_array_distinct: {
        Args: { p_values: string[] }
        Returns: boolean
      }
      chat_text_array_words: {
        Args: { p_values: string[] }
        Returns: string
      }
      chat_tool_policies_valid: {
        Args: { p_policies: Json }
        Returns: boolean
      }
      citation_competitor_sources: {
        Args: {
          p_brand_domains: string[]
          p_brand_id: string
          p_competitor_domains: string[]
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          answers_feeding: number
          competitor_id: string
          domain: string
          strength: number
        }[]
      }
      citation_competitor_sources_daily: {
        Args: {
          p_brand_domains: string[]
          p_brand_id: string
          p_competitor_domains: string[]
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          answers_feeding: number
          competitor_id: string
          domain: string
          strength: number
        }[]
      }
      citation_gap_domains: {
        Args: {
          p_brand_domains: string[]
          p_brand_id: string
          p_competitor_domains: string[]
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          appears_in_ours: boolean
          competitor_answers: number
          competitor_names: string[]
          domain: string
          our_answer_count: number
          strength: number
          total_answers: number
        }[]
      }
      citation_gap_domains_daily: {
        Args: {
          p_brand_domains: string[]
          p_brand_id: string
          p_competitor_domains: string[]
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          appears_in_ours: boolean
          competitor_answers: number
          competitor_names: string[]
          domain: string
          our_answer_count: number
          strength: number
          total_answers: number
        }[]
      }
      citation_url_candidates: {
        Args: { p_brand_id: string; p_domain: string }
        Returns: {
          id: number
          title: string
          url: string
        }[]
      }
      citation_url_ids: {
        Args: { p_urls: Json }
        Returns: {
          id: number
          url: string
        }[]
      }
      citation_url_occurrences: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
          p_url_ids: number[]
        }
        Returns: {
          brand_mentioned: boolean
          citations_in_answer: number
          created_at: string
          model_used: string
          platform: string
          prompt_id: string
          prompt_text: string
          rank: number
          region: string
          result_id: string
          sentiment: string
          total_sources: number
        }[]
      }
      citations_domains: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          domain: string
          models: string[]
          results_citing: number
          total_citations: number
        }[]
      }
      citations_domains_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          domain: string
          models: string[]
          results_citing: number
          total_citations: number
        }[]
      }
      citations_urls: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_domains?: string[]
          p_exclude_domains?: string[]
          p_limit?: number
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          domain: string
          models: string[]
          results_citing: number
          title: string
          total_citations: number
          total_urls: number
          url: string
        }[]
      }
      citations_urls_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_domains?: string[]
          p_exclude_domains?: string[]
          p_limit?: number
          p_models?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          domain: string
          models: string[]
          results_citing: number
          title: string
          total_citations: number
          total_urls: number
          url: string
        }[]
      }
      citations_window_stats: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          regions: string[]
          results: number
        }[]
      }
      citations_window_stats_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          regions: string[]
          results: number
        }[]
      }
      competitor_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      competitor_aggregates_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      content_opportunity_aggregates: {
        Args: {
          p_brand_id: string
          p_impact?: string
          p_q?: string
          p_status?: string
          p_type?: string
        }
        Returns: {
          avg_score: number
          high_impact_count: number
          sent_count: number
        }[]
      }
      content_draft_sources: {
        Args: { p_days?: number; p_draft_id: string }
        Returns: Json
      }
      content_draft_cited_answers: {
        Args: { p_days?: number; p_draft_id: string }
        Returns: Json
      }
      content_draft_decide_suggestions: {
        Args: { p_ids: string[]; p_status: string }
        Returns: number
      }
      content_draft_keep_source: {
        Args: { p_draft_id: string; p_url: string }
        Returns: string[]
      }
      content_draft_last_deliveries: {
        Args: { p_draft_ids: string[] }
        Returns: {
          agent_run_id: string | null
          batch_id: string | null
          brand_id: string
          created_at: string
          draft_id: string | null
          error: string | null
          external_id: string | null
          http_status: number | null
          id: string
          organization_id: string
          published_at: string | null
          published_url: string | null
          response_excerpt: string | null
          sent_at: string | null
          sent_by: string | null
          slug: string | null
          status: string
          target: string
          target_collection: string | null
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "content_draft_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      content_draft_member: { Args: { p_draft_id: string }; Returns: boolean }
      content_draft_restore: { Args: { p_version_id: string }; Returns: Json }
      content_draft_snapshot: {
        Args: { p_draft_id: string; p_origin: string }
        Returns: string
      }
      content_draft_versions_prune: {
        Args: { p_before: string; p_limit: number }
        Returns: number
      }
      content_page_conversions: {
        Args: { p_brand_id: string; p_days: number; p_page: string }
        Returns: Json
      }
      content_page_impact: {
        Args: { p_brand_id: string; p_days: number; p_page: string }
        Returns: Json
      }
      content_page_results: {
        Args: { p_brand_id: string; p_days: number; p_page: string }
        Returns: Json
      }
      content_plan_insights: {
        Args: { p_brand_id: string; p_days?: number }
        Returns: Json
      }
      content_plan_pages: {
        Args: { p_brand_id: string; p_days?: number }
        Returns: Json
      }
      content_start_prompts: {
        Args: { p_brand_id: string; p_days?: number; p_limit?: number }
        Returns: Json
      }
      content_page_overlap: {
        Args: { p_brand_id: string; p_prompt_ids: string[]; p_since?: string }
        Returns: {
          citations: number
          gsc_position: number | null
          page: string
          prompts_in_common: number
          title: string | null
        }[]
      }
      finish_agent_go_live: {
        Args: {
          p_delivery_id?: string
          p_error?: string
          p_external_id?: string
          p_id: string
          p_published_url?: string
          p_status: string
        }
        Returns: boolean
      }
      ga_page_ai_visibility: {
        Args: { p_brand_id: string; p_since: string }
        Returns: {
          ai_platforms: string[]
          ai_sessions: number
          citations: number
          citing_prompts: number
          engaged_sessions: number
          engagement_seconds: number
          key_events: number
          landing_page: string
          revenue: number
          sessions: number
          targeting_prompts: number
          transactions: number
        }[]
      }
      ga_platform_value: {
        Args: { p_brand_id: string; p_since: string | null; p_until: string }
        Returns: {
          engaged_sessions: number
          key_event_sessions: number
          key_events: number
          platform: string
          sessions: number
          surfaces: Json
        }[]
      }
      ga_traffic_totals: {
        Args: { p_brand_id: string; p_since: string | null; p_until: string }
        Returns: {
          ai_engaged_sessions: number
          ai_key_event_sessions: number
          ai_key_events: number
          ai_revenue: number
          ai_sessions: number
          organic_engaged_sessions: number
          organic_key_event_sessions: number
          organic_key_events: number
          organic_sessions: number
          sessions: number
        }[]
      }
      get_latest_prompt_results:
        | {
            Args: { p_brand_id: string; p_platform?: string }
            Returns: {
              brand_id: string
              citation_count: number
              citations: Json
              competitor_mentions: Json
              created_at: string
              id: string
              inline_products: Json
              mention_count: number
              mention_position: number | null
              mentioned_entity_count: number | null
              model_used: string | null
              platform: string
              prompt_id: string
              region: string | null
              response: string
              search_queries: Json
              sentiment: string
              shopping_cards: Json
              visibility_score: number
            }[]
            SetofOptions: {
              from: "*"
              to: "prompt_results"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_brand_id: string
              p_date_from?: string
              p_date_to?: string
              p_model?: string
              p_platform?: string
              p_region?: string
            }
            Returns: {
              brand_id: string
              citation_count: number
              citations: Json
              competitor_mentions: Json
              created_at: string
              id: string
              inline_products: Json
              mention_count: number
              mention_position: number | null
              mentioned_entity_count: number | null
              model_used: string | null
              platform: string
              prompt_id: string
              region: string | null
              response: string
              search_queries: Json
              sentiment: string
              shopping_cards: Json
              visibility_score: number
            }[]
            SetofOptions: {
              from: "*"
              to: "prompt_results"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      getting_started_facts: {
        Args: { p_brand_id: string }
        Returns: Json
      }
      getting_started_page_opened: {
        Args: { p_brand_id: string; p_step: string }
        Returns: boolean
      }
      gsc_candidate_queries: {
        Args: { p_brand_id: string; p_min_impressions: number; p_since: string }
        Returns: {
          avg_position: number
          clicks: number
          impressions: number
          query: string
        }[]
      }
      gsc_click_totals: {
        Args: {
          p_brand_id: string
          p_latest?: boolean
          p_since: string | null
          p_until: string
        }
        Returns: {
          clicks: number
          last_date: string | null
          prev_clicks: number | null
          since: string | null
          until: string | null
        }[]
      }
      head_to_head_daily: {
        Args: { p_brand_id: string; p_competitor_id: string }
        Returns: Json
      }
      insights_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_aggregates_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_breakdown_groups: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_change_drivers: {
        Args: {
          p_brand_id: string
          p_cur_from: string
          p_cur_to: string
          p_models?: string[]
          p_prev_from: string
          p_prev_to: string
          p_region?: string
          p_same_prompts?: boolean
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_change_drivers_daily: {
        Args: {
          p_brand_id: string
          p_cur_from: string
          p_cur_to: string
          p_models?: string[]
          p_prev_from: string
          p_prev_to: string
          p_region?: string
          p_same_prompts?: boolean
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_filter_options: {
        Args: { p_brand_id: string }
        Returns: {
          models: string[]
          regions: string[]
        }[]
      }
      insights_kpi_series: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_platform_compare: {
        Args: {
          p_brand_id: string
          p_cur_from?: string
          p_cur_to?: string
          p_models?: string[]
          p_prev_from?: string
          p_prev_to?: string
          p_region?: string
          p_same_prompts?: boolean
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_platform_compare_daily: {
        Args: {
          p_brand_id: string
          p_cur_from?: string
          p_cur_to?: string
          p_models?: string[]
          p_prev_from?: string
          p_prev_to?: string
          p_region?: string
          p_same_prompts?: boolean
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_same_prompt_compare: {
        Args: {
          p_brand_id: string
          p_cur_from: string
          p_cur_to: string
          p_models?: string[]
          p_prev_from: string
          p_prev_to: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_same_prompt_compare_daily: {
        Args: {
          p_brand_id: string
          p_cur_from: string
          p_cur_to: string
          p_models?: string[]
          p_prev_from: string
          p_prev_to: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_topic_competitors_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_region?: string
        }
        Returns: Json
      }
      insights_trend_markers: {
        Args: {
          p_brand_id: string
          p_from?: string
          p_to?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      mentions_overview: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to?: string
          p_platform?: string
          p_region?: string
          p_search?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      mentions_list: {
        Args: {
          p_brand_id: string
          p_competitor_id?: string
          p_date_from: string
          p_date_to?: string
          p_group?: string
          p_limit?: number
          p_offset?: number
          p_platform?: string
          p_region?: string
          p_search?: string
          p_sentiment?: string
          p_sort?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      mentions_perception: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to?: string
          p_platform?: string
          p_region?: string
          p_search?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      override_mention_sentiment: {
        Args: {
          p_note?: string
          p_result_id: string
          p_sentiment: string
          p_user_id?: string
        }
        Returns: Json
      }
      normalize_page_path: { Args: { p_url: string }; Returns: string }
      import_prompts: {
        Args: {
          p_max_locations: number
          p_organization_id: string
          p_prompt_set_id: string
          p_rows: Json
        }
        Returns: {
          id: string
          idx: number
        }[]
      }
      org_brand_count: { Args: { p_organization_id: string }; Returns: number }
      org_prompt_location_usage: {
        Args: { p_organization_id: string }
        Returns: {
          brand_id: string
          locations: number
        }[]
      }
      organization_has_other_members: {
        Args: { p_except: string; p_org: string }
        Returns: boolean
      }
      prompt_performance_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      prompt_position_summaries: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_region?: string
        }
        Returns: {
          entity_count: number
          entity_sum: number
          mention_answers: number
          platform: string
          position_count: number
          position_sum: number
          prompt_id: string
          runs: number
        }[]
      }
      prompt_position_summaries_json: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_region?: string
        }
        Returns: Json
      }
      prompt_usage_summary: {
        Args: { p_brand_id: string }
        Returns: {
          brand_active: number
          brand_paused: number
          account_active: number
          account_brands: number
          account_locations: number
        }[]
      }
      prompt_visibility_summaries: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_region?: string
        }
        Returns: {
          avg_visibility: number
          avg_visibility_visible: number
          citation_answers: number
          last_run_at: string
          mention_answers: number
          position_factor: number
          prompt_id: string
          runs: number
          total_citations: number
          total_mentions: number
          visible_runs: number
        }[]
      }
      refresh_insights_daily: {
        Args: { p_brand_id: string; p_day_from: string; p_day_to: string }
        Returns: undefined
      }
      remove_ai_provider_key: {
        Args: { p_organization_id: string; p_provider: string }
        Returns: string
      }
      report_citation_evidence: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
          p_limit?: number
          p_prompts_per_url?: number
        }
        Returns: {
          domain: string
          sourced_prompts: string[]
          title: string
          total_citations: number
          url: string
        }[]
      }
      report_prompt_performance: {
        Args: { p_brand_id: string; p_date_from: string; p_date_to: string }
        Returns: {
          citation_answers: number
          mention_answers: number
          pos_n: number
          pos_sum: number
          prompt_id: string
          prompt_text: string
          runs: number
          sum_visibility: number
          total_mentions: number
          visible_runs: number
        }[]
      }
      report_query_fanout: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
          p_limit?: number
        }
        Returns: {
          engines: string[]
          query: string
          times_searched: number
        }[]
      }
      report_query_fanout_engines: {
        Args: { p_brand_id: string; p_date_from: string; p_date_to: string }
        Returns: {
          answers_with_fanout: number
          distinct_queries: number
          engine: string
        }[]
      }
      report_topic_performance: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
          p_prev_from: string
        }
        Returns: {
          citation_answers: number
          mention_answers: number
          pos_n: number
          pos_sum: number
          prev_citation_answers: number
          prev_mention_answers: number
          prev_pos_n: number
          prev_pos_sum: number
          prev_runs: number
          prev_visible_runs: number
          runs: number
          sum_visibility: number
          topic_id: string
          topic_name: string
          visible_runs: number
        }[]
      }
      reserve_agent_go_live: {
        Args: {
          p_agent_id: string
          p_agent_run_id: string
          p_brand_id: string
          p_content_draft_id: string
          p_kind: string
          p_limit: number
          p_organization_id: string
          p_run_id: string
          p_target: string
          p_tool_key: string
        }
        Returns: string
      }
      seed_kpi_presets: {
        Args: { p_brand_id: string; p_kpis: Json }
        Returns: boolean
      }
      set_active_ai_provider: {
        Args: {
          p_only_if_none?: boolean
          p_organization_id: string
          p_provider: string
        }
        Returns: boolean
      }
      share_of_voice_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      share_of_voice_aggregates_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      ship_cms_publish: {
        Args: {
          p_action_id: string
          p_brand_id: string
          p_content_draft_id: string
          p_delivery_id: string
          p_execution_mode: string
          p_organization_id: string
          p_republish_days: number
          p_shipped_at: string
          p_shipped_by: string
          p_title: string
          p_url: string
        }
        Returns: {
          created: boolean
          ship_event_id: string
        }[]
      }
      shopping_amazon_share_weekly: {
        Args: { p_as_of?: string; p_brand_id: string }
        Returns: {
          amazon_cards: number
          classified_cards: number
          week_start: string
        }[]
      }
      shopping_filter_options: {
        Args: { p_brand_id: string }
        Returns: {
          platforms: string[]
          regions: string[]
        }[]
      }
      catalog_product_ai_stats: {
        Args: {
          p_brand_id: string
          p_from: string
          p_product_id?: string
          p_to?: string
        }
        Returns: {
          ai_visits: number
          currency: string | null
          orders: number
          product_id: string
          revenue: number | null
        }[]
      }
      shopping_merchant_split: {
        Args: {
          p_brand_id: string
          p_chatgpt_regions?: string[]
          p_from?: string
          p_platforms?: string[]
          p_regions?: string[]
          p_to?: string
        }
        Returns: {
          amazon_cards: number
          ebay_cards: number
          other_marketplace_cards: number
          own_store_cards: number
          reseller_cards: number
          unclassified_cards: number
          walmart_cards: number
        }[]
      }
      shopping_overview: {
        Args: {
          p_brand_id: string
          p_chatgpt_regions?: string[]
          p_from?: string
          p_platforms?: string[]
          p_regions?: string[]
          p_to?: string
          p_trend_from?: string
        }
        Returns: Json
      }
      shopping_own_product_offers: {
        Args: {
          p_brand_id: string
          p_chatgpt_regions?: string[]
          p_from?: string
          p_platforms?: string[]
          p_regions?: string[]
          p_to?: string
        }
        Returns: Json
      }
      signals_summary: {
        Args: { p_brand_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      signals_new_count: {
        Args: { p_brand_id: string }
        Returns: number
      }
      topics_overview_aggregates: {
        Args: { p_brand_id: string }
        Returns: {
          active_prompts: number
          answers: number
          citation_answers: number
          comp_mentions: number
          competitors: Json
          cur_answers: number
          cur_citation_answers: number
          cur_mention_answers: number
          cur_pos_n: number
          cur_pos_sum: number
          daily: Json
          last_run_at: string
          mention_answers: number
          pos_n: number
          pos_sum: number
          prev_answers: number
          prev_citation_answers: number
          prev_mention_answers: number
          prev_pos_n: number
          prev_pos_sum: number
          topic_id: string
          total_citations: number
          total_mentions: number
          visible_prompts: number
        }[]
      }
      topics_overview_window: {
        Args: { p_brand_id: string; p_date_from: string; p_date_to?: string }
        Returns: {
          active_prompts: number
          answers: number
          citation_answers: number
          comp_mentions: number
          competitors: Json
          daily: Json
          last_run_at: string
          mention_answers: number
          pos_n: number
          pos_sum: number
          prev_answers: number
          prev_citation_answers: number
          prev_mention_answers: number
          prev_pos_n: number
          prev_pos_sum: number
          topic_id: string
          total_citations: number
          total_mentions: number
          visible_prompts: number
        }[]
      }
      tracked_prompt_count: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: number
      }
      tracked_prompt_count_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: number
      }
      url_decode_safe: { Args: { p_value: string }; Returns: string }
      user_brand_ids: { Args: never; Returns: string[] }
      visibility_rate_trend: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      visibility_rate_trend_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      visibility_trend_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_granularity?: string
          p_models?: string[]
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      visible_prompt_stats: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      visible_prompt_stats_daily: {
        Args: {
          p_brand_id: string
          p_day_from?: string
          p_day_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "expired" | "revoked"
      user_role: "admin" | "manager" | "analyst" | "agency_partner"
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
      invitation_status: ["pending", "accepted", "expired", "revoked"],
      user_role: ["admin", "manager", "analyst", "agency_partner"],
    },
  },
} as const
