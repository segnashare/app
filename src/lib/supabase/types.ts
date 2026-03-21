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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          action: string
          actor_role: Database["public"]["Enums"]["app_role"] | null
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_name: string
          id: string
          payload: Json
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_name?: string
          id?: string
          payload?: Json
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_name?: string
          id?: string
          payload?: Json
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          provider: string
          provider_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          provider?: string
          provider_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          provider?: string
          provider_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_plan_prices: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          monthly_included_orders: number
          monthly_included_points: number
          plan_code: string
          provider: string
          stripe_price_id: string
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          monthly_included_orders?: number
          monthly_included_points?: number
          plan_code: string
          provider?: string
          stripe_price_id: string
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          monthly_included_orders?: number
          monthly_included_points?: number
          plan_code?: string
          provider?: string
          stripe_price_id?: string
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      billing_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          provider_event_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cart_deposits: {
        Row: {
          amount_points: number
          cart_id: string
          created_at: string
          deposit_status: string
          id: string
          user_id: string
          wallet_transaction_id: string | null
        }
        Insert: {
          amount_points: number
          cart_id: string
          created_at?: string
          deposit_status?: string
          id?: string
          user_id: string
          wallet_transaction_id?: string | null
        }
        Update: {
          amount_points?: number
          cart_id?: string
          created_at?: string
          deposit_status?: string
          id?: string
          user_id?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_deposits_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_deposits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_disputes: {
        Row: {
          cart_id: string
          created_at: string
          deleted_at: string | null
          details: string | null
          id: string
          opened_by_user_id: string
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          opened_by_user_id: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          opened_by_user_id?: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_disputes_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_disputes_opened_by_user_id_fkey"
            columns: ["opened_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          deleted_at: string | null
          id: string
          item_id: string
          owner_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id: string
          owner_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id?: string
          owner_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_payments: {
        Row: {
          amount_points: number
          cart_id: string
          created_at: string
          id: string
          payer_user_id: string
          payment_status: string
          wallet_transaction_id: string | null
        }
        Insert: {
          amount_points: number
          cart_id: string
          created_at?: string
          id?: string
          payer_user_id: string
          payment_status?: string
          wallet_transaction_id?: string | null
        }
        Update: {
          amount_points?: number
          cart_id?: string
          created_at?: string
          id?: string
          payer_user_id?: string
          payment_status?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_payments_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_payments_payer_user_id_fkey"
            columns: ["payer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_pricing_snapshots: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          pricing: Json
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          pricing?: Json
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          pricing?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cart_pricing_snapshots_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_refunds: {
        Row: {
          amount_points: number
          cart_id: string
          created_at: string
          id: string
          reason: string | null
          user_id: string
          wallet_transaction_id: string | null
        }
        Insert: {
          amount_points: number
          cart_id: string
          created_at?: string
          id?: string
          reason?: string | null
          user_id: string
          wallet_transaction_id?: string | null
        }
        Update: {
          amount_points?: number
          cart_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          user_id?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_refunds_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_refunds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_shipping_addresses: {
        Row: {
          cart_id: string
          city: string | null
          country: string | null
          created_at: string
          full_name: string | null
          id: string
          line1: string | null
          line2: string | null
          phone: string | null
          postal_code: string | null
        }
        Insert: {
          cart_id: string
          city?: string | null
          country?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          line1?: string | null
          line2?: string | null
          phone?: string | null
          postal_code?: string | null
        }
        Update: {
          cart_id?: string
          city?: string | null
          country?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          line1?: string | null
          line2?: string | null
          phone?: string | null
          postal_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_shipping_addresses_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_status_history: {
        Row: {
          actor_user_id: string | null
          cart_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["cart_status"] | null
          id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["cart_status"]
        }
        Insert: {
          actor_user_id?: string | null
          cart_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["cart_status"] | null
          id?: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["cart_status"]
        }
        Update: {
          actor_user_id?: string | null
          cart_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["cart_status"] | null
          id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["cart_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cart_status_history_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_status_history_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          locked_until: string | null
          status: Database["public"]["Enums"]["cart_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          locked_until?: string | null
          status?: Database["public"]["Enums"]["cart_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          locked_until?: string | null
          status?: Database["public"]["Enums"]["cart_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      item_brands: {
        Row: {
          created_at: string
          id: string
          label: string
          logo_path: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          logo_path?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          logo_path?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_couleurs: {
        Row: {
          created_at: string
          id: string
          label: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_category_id: string | null
          size_scope: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_category_id?: string | null
          size_scope?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_category_id?: string | null
          size_scope?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      item_materiaux: {
        Row: {
          created_at: string
          id: string
          label: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_disputes: {
        Row: {
          cart_dispute_id: string
          created_at: string
          deleted_at: string | null
          details: string | null
          id: string
          item_id: string
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cart_dispute_id: string
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          item_id: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cart_dispute_id?: string
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          item_id?: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_disputes_cart_dispute_id_fkey"
            columns: ["cart_dispute_id"]
            isOneToOne: false
            referencedRelation: "cart_disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_disputes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_favorites: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          item_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_favorites_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      item_inventory_locks: {
        Row: {
          cart_id: string | null
          created_at: string
          expires_at: string
          id: string
          item_id: string
          locked_by_user_id: string
        }
        Insert: {
          cart_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          item_id: string
          locked_by_user_id: string
        }
        Update: {
          cart_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          item_id?: string
          locked_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_inventory_locks_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_inventory_locks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_inventory_locks_locked_by_user_id_fkey"
            columns: ["locked_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      item_price_history: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: string
          item_id: string
          new_price_points: number
          old_price_points: number | null
          reason: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          item_id: string
          new_price_points: number
          old_price_points?: number | null
          reason?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          item_id?: string
          new_price_points?: number
          old_price_points?: number | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_price_history_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_price_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_reports: {
        Row: {
          created_at: string
          deleted_at: string | null
          details: string | null
          id: string
          item_id: string
          reason: string
          reporter_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          item_id: string
          reason: string
          reporter_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          item_id?: string
          reason?: string
          reporter_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_reports_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      item_status_history: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["item_status"] | null
          id: string
          item_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["item_status"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["item_status"] | null
          id?: string
          item_id: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["item_status"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["item_status"] | null
          id?: string
          item_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["item_status"]
        }
        Relationships: [
          {
            foreignKeyName: "item_status_history_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_status_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_condition_history: {
        Row: {
          id: string
          item_id: string
          source: string
          condition_score: string
          description: string | null
          defect_notes: string | null
          recorded_at: string
          recorded_by_user_id: string | null
          shipment_item_id: string | null
          metadata: Json
          created_at: string
          status: string
        }
        Insert: {
          id?: string
          item_id: string
          source: string
          condition_score: string
          description?: string | null
          defect_notes?: string | null
          recorded_at?: string
          recorded_by_user_id?: string | null
          shipment_item_id?: string | null
          metadata?: Json
          created_at?: string
          status?: string
        }
        Update: {
          id?: string
          item_id?: string
          source?: string
          condition_score?: string
          description?: string | null
          defect_notes?: string | null
          recorded_at?: string
          recorded_by_user_id?: string | null
          shipment_item_id?: string | null
          metadata?: Json
          created_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_condition_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          item_brand_id: string | null
          item_category_id: string | null
          item_couleur_id: string | null
          item_materiaux_id: string | null
          item_size_id: string | null
          owner_user_id: string
          photos: Json
          price_points: number | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          item_brand_id?: string | null
          item_category_id?: string | null
          item_couleur_id?: string | null
          item_materiaux_id?: string | null
          item_size_id?: string | null
          owner_user_id: string
          photos?: Json
          price_points?: number | null
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          item_brand_id?: string | null
          item_category_id?: string | null
          item_couleur_id?: string | null
          item_materiaux_id?: string | null
          item_size_id?: string | null
          owner_user_id?: string
          photos?: Json
          price_points?: number | null
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_item_brand_id_fkey"
            columns: ["item_brand_id"]
            isOneToOne: false
            referencedRelation: "item_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_item_category_id_fkey"
            columns: ["item_category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_item_couleur_id_fkey"
            columns: ["item_couleur_id"]
            isOneToOne: false
            referencedRelation: "item_couleurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_item_materiaux_id_fkey"
            columns: ["item_materiaux_id"]
            isOneToOne: false
            referencedRelation: "item_materiaux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_item_size_id_fkey"
            columns: ["item_size_id"]
            isOneToOne: false
            referencedRelation: "sizes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action_payload: Json
          action_type: string
          actor_user_id: string | null
          created_at: string
          id: string
          moderation_case_id: string
        }
        Insert: {
          action_payload?: Json
          action_type: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          moderation_case_id: string
        }
        Update: {
          action_payload?: Json
          action_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          moderation_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_moderation_case_id_fkey"
            columns: ["moderation_case_id"]
            isOneToOne: false
            referencedRelation: "moderation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_case_links: {
        Row: {
          created_at: string
          id: string
          linked_id: string
          linked_type: string
          moderation_case_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          linked_id: string
          linked_type: string
          moderation_case_id: string
        }
        Update: {
          created_at?: string
          id?: string
          linked_id?: string
          linked_type?: string
          moderation_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_case_links_moderation_case_id_fkey"
            columns: ["moderation_case_id"]
            isOneToOne: false
            referencedRelation: "moderation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_cases: {
        Row: {
          assigned_to_user_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          opened_by_user_id: string | null
          resolution: string | null
          severity: string
          status: Database["public"]["Enums"]["moderation_case_status"]
          updated_at: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          opened_by_user_id?: string | null
          resolution?: string | null
          severity?: string
          status?: Database["public"]["Enums"]["moderation_case_status"]
          updated_at?: string
        }
        Update: {
          assigned_to_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          opened_by_user_id?: string | null
          resolution?: string | null
          severity?: string
          status?: Database["public"]["Enums"]["moderation_case_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_cases_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_cases_opened_by_user_id_fkey"
            columns: ["opened_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_evidence: {
        Row: {
          created_at: string
          deleted_at: string | null
          evidence_type: string
          file_url: string
          id: string
          metadata: Json
          moderation_case_id: string
          updated_at: string
          uploaded_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          evidence_type: string
          file_url: string
          id?: string
          metadata?: Json
          moderation_case_id: string
          updated_at?: string
          uploaded_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          evidence_type?: string
          file_url?: string
          id?: string
          metadata?: Json
          moderation_case_id?: string
          updated_at?: string
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_evidence_moderation_case_id_fkey"
            columns: ["moderation_case_id"]
            isOneToOne: false
            referencedRelation: "moderation_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_evidence_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_notes: {
        Row: {
          author_user_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          moderation_case_id: string
          note: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          moderation_case_id: string
          note: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          moderation_case_id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_notes_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_notes_moderation_case_id_fkey"
            columns: ["moderation_case_id"]
            isOneToOne: false
            referencedRelation: "moderation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: string
          id: string
          progress: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: string
          id?: string
          progress?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: string
          id?: string
          progress?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          qualified_at: string | null
          referral_code: string
          referral_code_id: string
          referred_user_id: string
          referrer_user_id: string
          request_id: string | null
          source_id: string
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          qualified_at?: string | null
          referral_code: string
          referral_code_id: string
          referred_user_id: string
          referrer_user_id: string
          request_id?: string | null
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          qualified_at?: string | null
          referral_code?: string
          referral_code_id?: string
          referred_user_id?: string
          referrer_user_id?: string
          request_id?: string | null
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referrals_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shipment_bag_assignments: {
        Row: {
          assigned_at: string
          bag_id: string
          created_at: string
          id: string
          shipment_id: string
          unassigned_at: string | null
        }
        Insert: {
          assigned_at?: string
          bag_id: string
          created_at?: string
          id?: string
          shipment_id: string
          unassigned_at?: string | null
        }
        Update: {
          assigned_at?: string
          bag_id?: string
          created_at?: string
          id?: string
          shipment_id?: string
          unassigned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_bag_assignments_bag_id_fkey"
            columns: ["bag_id"]
            isOneToOne: false
            referencedRelation: "shipment_bags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_bag_assignments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_bags: {
        Row: {
          bag_code: string
          created_at: string
          deleted_at: string | null
          id: string
          size: Database["public"]["Enums"]["bag_size"]
          status: string
          updated_at: string
        }
        Insert: {
          bag_code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          size: Database["public"]["Enums"]["bag_size"]
          status?: string
          updated_at?: string
        }
        Update: {
          bag_code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          size?: Database["public"]["Enums"]["bag_size"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipment_destinations: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          destination_type: Database["public"]["Enums"]["shipment_destination_type"]
          full_name: string | null
          id: string
          line1: string | null
          line2: string | null
          metadata: Json
          phone: string | null
          postal_code: string | null
          provider_point_id: string | null
          shipment_id: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          destination_type: Database["public"]["Enums"]["shipment_destination_type"]
          full_name?: string | null
          id?: string
          line1?: string | null
          line2?: string | null
          metadata?: Json
          phone?: string | null
          postal_code?: string | null
          provider_point_id?: string | null
          shipment_id: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          destination_type?: Database["public"]["Enums"]["shipment_destination_type"]
          full_name?: string | null
          id?: string
          line1?: string | null
          line2?: string | null
          metadata?: Json
          phone?: string | null
          postal_code?: string | null
          provider_point_id?: string | null
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_destinations_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          provider_event_id: string | null
          shipment_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          provider_event_id?: string | null
          shipment_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          provider_event_id?: string | null
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          cart_item_id: string
          checked_at: string | null
          checked_by_user_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          return_status: Database["public"]["Enums"]["shipment_return_status"]
          shipment_id: string
          updated_at: string
        }
        Insert: {
          cart_item_id: string
          checked_at?: string | null
          checked_by_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          return_status?: Database["public"]["Enums"]["shipment_return_status"]
          shipment_id: string
          updated_at?: string
        }
        Update: {
          cart_item_id?: string
          checked_at?: string | null
          checked_by_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          return_status?: Database["public"]["Enums"]["shipment_return_status"]
          shipment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_cart_item_id_fkey"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "cart_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_checked_by_user_id_fkey"
            columns: ["checked_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_labels: {
        Row: {
          created_at: string
          id: string
          label_format: string | null
          label_status: string
          label_url: string | null
          shipment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_format?: string | null
          label_status?: string
          label_url?: string | null
          shipment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_format?: string | null
          label_status?: string
          label_url?: string | null
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_labels_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_proofs: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          file_url: string
          id: string
          proof_type: string
          shipment_item_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          file_url: string
          id?: string
          proof_type?: string
          shipment_item_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          file_url?: string
          id?: string
          proof_type?: string
          shipment_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_proofs_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_proofs_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_providers: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      shipment_status_history: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["shipment_status"] | null
          id: string
          reason: string | null
          shipment_id: string
          to_status: Database["public"]["Enums"]["shipment_status"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["shipment_status"] | null
          id?: string
          reason?: string | null
          shipment_id: string
          to_status: Database["public"]["Enums"]["shipment_status"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["shipment_status"] | null
          id?: string
          reason?: string | null
          shipment_id?: string
          to_status?: Database["public"]["Enums"]["shipment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "shipment_status_history_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_status_history_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          cart_id: string
          created_at: string
          deleted_at: string | null
          id: string
          provider_id: string | null
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          provider_id?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          provider_id?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_shipments_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_shipments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "shipment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      sizes: {
        Row: {
          code: string
          created_at: string
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_by_user_id: string | null
          blocked_user_id: string
          created_at: string
          deleted_at: string | null
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          blocked_by_user_id?: string | null
          blocked_user_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          blocked_by_user_id?: string | null
          blocked_user_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_by_user_id_fkey"
            columns: ["blocked_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocked_user_id_fkey"
            columns: ["blocked_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          consent_type: string
          consent_version: string | null
          created_at: string
          deleted_at: string | null
          granted: boolean
          granted_at: string
          id: string
          request_id: string | null
          revoked_at: string | null
          updated_at: string
          user_id: string
          version: string
        }
        Insert: {
          consent_type: string
          consent_version?: string | null
          created_at?: string
          deleted_at?: string | null
          granted: boolean
          granted_at?: string
          id?: string
          request_id?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_id: string
          version?: string
        }
        Update: {
          consent_type?: string
          consent_version?: string | null
          created_at?: string
          deleted_at?: string | null
          granted?: boolean
          granted_at?: string
          id?: string
          request_id?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_identity_verifications: {
        Row: {
          checked_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          payload: Json
          provider: string | null
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          payload?: Json
          provider?: string | null
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          payload?: Json
          provider?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_identity_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_monthly_entitlements: {
        Row: {
          created_at: string
          id: string
          included_orders_limit: number
          included_points_limit: number
          metadata: Json
          orders_used: number
          period_month: string
          plan_code: string
          points_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          included_orders_limit?: number
          included_points_limit?: number
          metadata?: Json
          orders_used?: number
          period_month: string
          plan_code: string
          points_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          included_orders_limit?: number
          included_points_limit?: number
          metadata?: Json
          orders_used?: number
          period_month?: string
          plan_code?: string
          points_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          brands: Json
          budget: Json
          created_at: string
          dressing: Json
          ethic: Json
          experience: Json
          id: string
          motivation: Json
          privacy: Json
          share: Json
          style: Json
          updated_at: string
          user_profile_id: string
        }
        Insert: {
          brands?: Json
          budget?: Json
          created_at?: string
          dressing?: Json
          ethic?: Json
          experience?: Json
          id?: string
          motivation?: Json
          privacy?: Json
          share?: Json
          style?: Json
          updated_at?: string
          user_profile_id: string
        }
        Update: {
          brands?: Json
          budget?: Json
          created_at?: string
          dressing?: Json
          ethic?: Json
          experience?: Json
          id?: string
          motivation?: Json
          privacy?: Json
          share?: Json
          style?: Json
          updated_at?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile_brands: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          rank: number
          user_profile_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          rank: number
          user_profile_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          rank?: number
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_brands_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile_sizes: {
        Row: {
          category: string
          created_at: string
          id: string
          size_id: string
          user_profile_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          size_id: string
          user_profile_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          size_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_sizes_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "sizes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_sizes_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          age: number | null
          answers: Json
          city: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          looks: Json
          photos: Json
          profile_data: Json
          score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          answers?: Json
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          looks?: Json
          photos?: Json
          profile_data?: Json
          score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          answers?: Json
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          looks?: Json
          photos?: Json
          profile_data?: Json
          score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          created_at: string
          deleted_at: string | null
          details: string | null
          id: string
          reason: string
          reported_user_id: string
          reporter_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          reason: string
          reported_user_id: string
          reporter_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          details?: string | null
          id?: string
          reason?: string
          reported_user_id?: string
          reporter_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          ip_address: unknown
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          session_token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string
          raw_payload: Json
          status: string
          trial_end: string | null
          trial_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          plan_code?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id: string
          raw_payload?: Json
          status?: string
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          plan_code?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string
          raw_payload?: Json
          status?: string
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_wallets: {
        Row: {
          balance: number
          balance_points: number
          created_at: string
          deleted_at: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          balance_points?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          balance_points?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          adress: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_login_at: string | null
          last_name: string | null
          locale: string | null
          onboarding_completed_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string | null
          updated_at: string
        }
        Insert: {
          adress?: string | null
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          last_login_at?: string | null
          last_name?: string | null
          locale?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          adress?: string | null
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_login_at?: string | null
          last_name?: string | null
          locale?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wallet_holds: {
        Row: {
          amount_points: number
          cart_id: string
          created_at: string
          expires_at: string
          id: string
          released_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_points: number
          cart_id: string
          created_at?: string
          expires_at: string
          id?: string
          released_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_points?: number
          cart_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          released_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_holds_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: true
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_holds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount_points: number
          cart_id: string | null
          created_at: string
          direction: string
          id: string
          idempotency_key: string | null
          kind: string
          metadata: Json
          status: string
          user_id: string
        }
        Insert: {
          amount_points: number
          cart_id?: string | null
          created_at?: string
          direction: string
          id?: string
          idempotency_key?: string | null
          kind: string
          metadata?: Json
          status?: string
          user_id: string
        }
        Update: {
          amount_points?: number
          cart_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          idempotency_key?: string | null
          kind?: string
          metadata?: Json
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_achievements: {
        Row: {
          badge_code: string
          created_at: string
          delta: number
          id: string
          idempotency_key: string | null
          metadata: Json
          request_id: string | null
          source_id: string
          source_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          badge_code: string
          created_at?: string
          delta: number
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          request_id?: string | null
          source_id?: string
          source_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          badge_code?: string
          created_at?: string
          delta?: number
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          request_id?: string | null
          source_id?: string
          source_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_achievements_badge_code_fkey"
            columns: ["badge_code"]
            isOneToOne: false
            referencedRelation: "xp_badges"
            referencedColumns: ["badge_code"]
          },
        ]
      }
      xp_actions: {
        Row: {
          action_code: string
          cap_count: number | null
          cap_period: string
          created_at: string
          description: string | null
          is_active: boolean
          label: string
          metadata: Json
          one_time: boolean
          updated_at: string
          xp_amount: number
        }
        Insert: {
          action_code: string
          cap_count?: number | null
          cap_period?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          label: string
          metadata?: Json
          one_time?: boolean
          updated_at?: string
          xp_amount: number
        }
        Update: {
          action_code?: string
          cap_count?: number | null
          cap_period?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          label?: string
          metadata?: Json
          one_time?: boolean
          updated_at?: string
          xp_amount?: number
        }
        Relationships: []
      }
      xp_badges: {
        Row: {
          badge_code: string
          created_at: string
          description: string | null
          icon: string | null
          is_active: boolean
          label: string
          metadata: Json
          updated_at: string
          xp_bonus: number
        }
        Insert: {
          badge_code: string
          created_at?: string
          description?: string | null
          icon?: string | null
          is_active?: boolean
          label: string
          metadata?: Json
          updated_at?: string
          xp_bonus?: number
        }
        Update: {
          badge_code?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          is_active?: boolean
          label?: string
          metadata?: Json
          updated_at?: string
          xp_bonus?: number
        }
        Relationships: []
      }
      xp_ledger: {
        Row: {
          action_code: string | null
          award_type: string
          badge_code: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          metadata: Json
          reason: string | null
          request_id: string | null
          source_id: string
          source_type: string
          updated_at: string
          user_id: string
          xp_delta: number
        }
        Insert: {
          action_code?: string | null
          award_type: string
          badge_code?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          reason?: string | null
          request_id?: string | null
          source_id?: string
          source_type?: string
          updated_at?: string
          user_id: string
          xp_delta: number
        }
        Update: {
          action_code?: string | null
          award_type?: string
          badge_code?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          reason?: string | null
          request_id?: string | null
          source_id?: string
          source_type?: string
          updated_at?: string
          user_id?: string
          xp_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_ledger_action_code_fkey"
            columns: ["action_code"]
            isOneToOne: false
            referencedRelation: "xp_actions"
            referencedColumns: ["action_code"]
          },
          {
            foreignKeyName: "xp_ledger_badge_code_fkey"
            columns: ["badge_code"]
            isOneToOne: false
            referencedRelation: "xp_badges"
            referencedColumns: ["badge_code"]
          },
        ]
      }
      xp_levels: {
        Row: {
          created_at: string
          estimated_active_time: string | null
          icon: string | null
          level_no: number
          rank_name: string
          updated_at: string
          xp_required: number
        }
        Insert: {
          created_at?: string
          estimated_active_time?: string | null
          icon?: string | null
          level_no: number
          rank_name: string
          updated_at?: string
          xp_required: number
        }
        Update: {
          created_at?: string
          estimated_active_time?: string | null
          icon?: string | null
          level_no?: number
          rank_name?: string
          updated_at?: string
          xp_required?: number
        }
        Relationships: []
      }
      xp_rewards: {
        Row: {
          badge_code: string | null
          created_at: string
          description: string | null
          is_active: boolean
          label: string
          level_no: number | null
          metadata: Json
          one_time: boolean
          reward_code: string
          reward_type: string
          trigger_event: string
          updated_at: string
          wallet_amount: number
        }
        Insert: {
          badge_code?: string | null
          created_at?: string
          description?: string | null
          is_active?: boolean
          label: string
          level_no?: number | null
          metadata?: Json
          one_time?: boolean
          reward_code: string
          reward_type: string
          trigger_event: string
          updated_at?: string
          wallet_amount?: number
        }
        Update: {
          badge_code?: string | null
          created_at?: string
          description?: string | null
          is_active?: boolean
          label?: string
          level_no?: number | null
          metadata?: Json
          one_time?: boolean
          reward_code?: string
          reward_type?: string
          trigger_event?: string
          updated_at?: string
          wallet_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_rewards_badge_code_fkey"
            columns: ["badge_code"]
            isOneToOne: false
            referencedRelation: "xp_badges"
            referencedColumns: ["badge_code"]
          },
          {
            foreignKeyName: "xp_rewards_level_no_fkey"
            columns: ["level_no"]
            isOneToOne: false
            referencedRelation: "xp_levels"
            referencedColumns: ["level_no"]
          },
        ]
      }
      xp_streak: {
        Row: {
          best_streak_days: number
          created_at: string
          current_streak_days: number
          last_streak_award_date: string | null
          last_visit_date: string | null
          metadata: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          best_streak_days?: number
          created_at?: string
          current_streak_days?: number
          last_streak_award_date?: string | null
          last_visit_date?: string | null
          metadata?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          best_streak_days?: number
          created_at?: string
          current_streak_days?: number
          last_streak_award_date?: string | null
          last_visit_date?: string | null
          metadata?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      xp_user_badges: {
        Row: {
          badge_code: string
          completed_at: string | null
          created_at: string
          current_value: number
          id: string
          is_completed: boolean
          last_progress_at: string | null
          metadata: Json
          progress_percent: number
          source_id: string
          source_type: string
          target_value: number
          user_id: string
        }
        Insert: {
          badge_code: string
          completed_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          is_completed?: boolean
          last_progress_at?: string | null
          metadata?: Json
          progress_percent?: number
          source_id?: string
          source_type?: string
          target_value?: number
          user_id: string
        }
        Update: {
          badge_code?: string
          completed_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          is_completed?: boolean
          last_progress_at?: string | null
          metadata?: Json
          progress_percent?: number
          source_id?: string
          source_type?: string
          target_value?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_user_badges_badge_code_fkey"
            columns: ["badge_code"]
            isOneToOne: false
            referencedRelation: "xp_badges"
            referencedColumns: ["badge_code"]
          },
        ]
      }
      xp_user_state: {
        Row: {
          created_at: string
          current_level: number
          last_xp_at: string | null
          level_progress_percent: number
          metadata: Json
          total_xp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_level?: number
          last_xp_at?: string | null
          level_progress_percent?: number
          metadata?: Json
          total_xp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_level?: number
          last_xp_at?: string | null
          level_progress_percent?: number
          metadata?: Json
          total_xp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      auth_user_stats_view: {
        Row: {
          confirmed_users: number | null
          onboarding_completed_users: number | null
          total_users: number | null
          unconfirmed_users: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_user_consent: {
        Args: {
          p_consent_type: string
          p_granted: boolean
          p_request_id?: string
          p_version: string
        }
        Returns: {
          consent_type: string
          consent_version: string | null
          created_at: string
          deleted_at: string | null
          granted: boolean
          granted_at: string
          id: string
          request_id: string | null
          revoked_at: string | null
          updated_at: string
          user_id: string
          version: string
        }
        SetofOptions: {
          from: "*"
          to: "user_consents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acquire_item_lock: {
        Args: { p_cart_id: string; p_item_id: string; p_ttl_seconds?: number }
        Returns: {
          cart_id: string | null
          created_at: string
          expires_at: string
          id: string
          item_id: string
          locked_by_user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "item_inventory_locks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_user_stats: {
        Args: never
        Returns: {
          confirmed_users: number
          onboarding_completed_users: number
          total_users: number
          unconfirmed_users: number
        }[]
      }
      billing_has_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: boolean
      }
      billing_is_admin: { Args: never; Returns: boolean }
      billing_plan_limits: {
        Args: { p_plan_code: string }
        Returns: {
          included_orders_limit: number
          included_points_limit: number
        }[]
      }
      billing_upsert_monthly_entitlement: {
        Args: {
          p_period_month?: string
          p_plan_code: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          id: string
          included_orders_limit: number
          included_points_limit: number
          metadata: Json
          orders_used: number
          period_month: string
          plan_code: string
          points_used: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_monthly_entitlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bootstrap_user_after_signup: {
        Args: {
          p_first_name?: string
          p_last_name?: string
          p_locale?: string
          p_request_id?: string
          p_timezone?: string
        }
        Returns: Json
      }
      capture_wallet_hold: {
        Args: { p_cart_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      complete_onboarding: {
        Args: {
          p_answers_json?: Json
          p_request_id?: string
          p_visibility_json?: Json
        }
        Returns: {
          completed_at: string | null
          created_at: string
          current_step: string
          id: string
          progress: Json
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "onboarding_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      derive_relative_city_from_adress: {
        Args: { p_adress: string }
        Returns: string
      }
      ensure_user_identity_verification_not_started: {
        Args: { p_request_id?: string; p_user_id?: string }
        Returns: {
          checked_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          payload: Json
          provider: string | null
          updated_at: string
          user_id: string
          verification_status: string
        }
        SetofOptions: {
          from: "*"
          to: "user_identity_verifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_wallet_holds: { Args: never; Returns: number }
      get_current_membership_state: { Args: never; Returns: Json }
      get_me_context: { Args: never; Returns: Json }
      get_profile_preference_visibility: { Args: never; Returns: Json }
      get_user_preferences_payload: { Args: never; Returns: Json }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      log_activity_event: {
        Args: { p_event_name: string; p_payload?: Json; p_request_id?: string }
        Returns: undefined
      }
      normalize_preference_payload: {
        Args: { p_default_value?: Json; p_payload: Json }
        Returns: Json
      }
      purge_expired_user_sessions: { Args: never; Returns: number }
      recompute_profile_score: {
        Args: { p_request_id?: string }
        Returns: Json
      }
      recompute_profile_score_for_user: {
        Args: { p_request_id?: string; p_user_id: string }
        Returns: Json
      }
      referrals_apply_code_on_subscription: {
        Args: {
          p_referral_code: string
          p_request_id?: string
          p_source_id?: string
        }
        Returns: Json
      }
      referrals_ensure_code_for_user: {
        Args: { p_user_id: string }
        Returns: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "referrals_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      referrals_generate_code: { Args: never; Returns: string }
      referrals_get_my_code: { Args: never; Returns: Json }
      referrals_increment_amie_invitee_badge: {
        Args: {
          p_referrer_user_id: string
          p_request_id?: string
          p_source_id?: string
        }
        Returns: Json
      }
      referrals_safe_numeric: { Args: { p_text: string }; Returns: number }
      refresh_user_profile_ages: { Args: never; Returns: number }
      refund_wallet_points: {
        Args: {
          p_amount_points: number
          p_cart_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      release_expired_item_locks: { Args: never; Returns: number }
      release_wallet_hold: {
        Args: {
          p_cart_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      reserve_cart_atomic: {
        Args: {
          p_cart_id: string
          p_hold_ttl_minutes?: number
          p_idempotency_key?: string
          p_lock_ttl_seconds?: number
        }
        Returns: Json
      }
      revoke_other_user_sessions: {
        Args: { p_current_session_token: string }
        Returns: number
      }
      revoke_user_session: {
        Args: { p_session_token: string }
        Returns: number
      }
      set_profile_preference_visibility: {
        Args: { p_request_id?: string; p_section: string; p_visible: boolean }
        Returns: Json
      }
      set_user_birth_date: {
        Args: { p_birth_date: string; p_request_id?: string }
        Returns: {
          adress: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_login_at: string | null
          last_name: string | null
          locale: string | null
          onboarding_completed_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_user_location: {
        Args: {
          p_adress: string
          p_relative_city?: string
          p_request_id?: string
          p_timezone?: string
        }
        Returns: {
          adress: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_login_at: string | null
          last_name: string | null
          locale: string | null
          onboarding_completed_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_user_phone_verified: {
        Args: { p_phone_e164: string; p_request_id?: string }
        Returns: {
          adress: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_login_at: string | null
          last_name: string | null
          locale: string | null
          onboarding_completed_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_user_profile_brands: {
        Args: { p_brand_ids: string[]; p_request_id?: string }
        Returns: Json
      }
      set_user_profile_sizes: {
        Args: {
          p_bottom_size_code: string
          p_request_id?: string
          p_shoes_size_code: string
          p_top_size_code: string
        }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_user_account_settings: {
        Args: {
          p_first_name?: string
          p_last_name?: string
          p_locale?: string
          p_request_id?: string
          p_timezone?: string
        }
        Returns: {
          adress: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_login_at: string | null
          last_name: string | null
          locale: string | null
          onboarding_completed_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_user_profile_public: {
        Args: { p_profile_json: Json; p_request_id?: string }
        Returns: {
          age: number | null
          answers: Json
          city: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          looks: Json
          photos: Json
          profile_data: Json
          score: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_onboarding_progress: {
        Args: {
          p_current_step: string
          p_progress_json?: Json
          p_request_id?: string
        }
        Returns: {
          completed_at: string | null
          created_at: string
          current_step: string
          id: string
          progress: Json
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "onboarding_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_user_session: {
        Args: {
          p_expires_at?: string
          p_ip_address?: unknown
          p_session_token: string
          p_user_agent?: string
        }
        Returns: {
          created_at: string
          expires_at: string | null
          id: string
          ip_address: unknown
          session_token: string
          user_agent: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wallet_available_points: { Args: { p_user_id: string }; Returns: number }
      wallet_credit_purchase: {
        Args: {
          p_amount_points: number
          p_checkout_session_id?: string
          p_credit_kind: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_payment_intent_id?: string
          p_provider?: string
          p_user_id: string
        }
        Returns: Json
      }
      xp_award_action: {
        Args: {
          p_action_code: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_request_id?: string
          p_source_id?: string
          p_source_type?: string
        }
        Returns: Json
      }
      xp_award_badge: {
        Args: {
          p_badge_code: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_request_id?: string
          p_source_id?: string
          p_source_type?: string
        }
        Returns: Json
      }
      xp_ensure_user_rows: { Args: { p_user_id: string }; Returns: undefined }
      xp_get_badges_progress: {
        Args: never
        Returns: {
          badge_code: string
          current_value: number
          description: string
          icon: string
          is_completed: boolean
          label: string
          progress_percent: number
          remaining_value: number
          target_value: number
        }[]
      }
      xp_get_level_for_xp: { Args: { p_total_xp: number }; Returns: number }
      xp_grant_rewards_for_event: {
        Args: {
          p_badge_code?: string
          p_level_no?: number
          p_request_id?: string
          p_trigger_event: string
          p_user_id: string
        }
        Returns: Json
      }
      xp_has_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: boolean
      }
      xp_is_admin: { Args: never; Returns: boolean }
      xp_is_moderator_or_admin: { Args: never; Returns: boolean }
      xp_record_badge_achievement: {
        Args: {
          p_badge_code: string
          p_delta: number
          p_idempotency_key?: string
          p_metadata?: Json
          p_request_id?: string
          p_source_id?: string
          p_source_type?: string
        }
        Returns: Json
      }
      xp_safe_numeric: { Args: { p_text: string }; Returns: number }
      xp_touch_daily_visit: {
        Args: { p_request_id?: string; p_source_id?: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "user" | "moderator" | "admin" | "super_admin"
      bag_size: "s" | "m" | "l"
      cart_status: "active" | "reserved" | "returned" | "archived" | "canceled"
      item_status:
        | "draft"
        | "draft_deleted"
        | "valuation"
        | "validation_pending"
        | "available"
        | "in_cart"
        | "reserved"
        | "retired"
        | "archived"
      moderation_case_status: "open" | "in_review" | "resolved" | "closed"
      shipment_destination_type: "pickup_point" | "home"
      shipment_return_status:
        | "pending_verification"
        | "en_verification"
        | "validated"
        | "dommage"
        | "nettoyage"
        | "nettoyage_leger"
        | "rejected"
      shipment_status:
        | "pending"
        | "ready"
        | "dropped"
        | "in_transit"
        | "delivered"
        | "returned"
        | "en_verification"
        | "return_validated"
        | "failed"
        | "closed"
      user_status: "active" | "suspended" | "blocked" | "deleted"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["user", "moderator", "admin", "super_admin"],
      bag_size: ["s", "m", "l"],
      cart_status: ["active", "reserved", "returned", "archived", "canceled"],
      item_status: [
        "draft",
        "draft_deleted",
        "valuation",
        "validation_pending",
        "available",
        "in_cart",
        "reserved",
        "retired",
        "archived",
      ],
      moderation_case_status: ["open", "in_review", "resolved", "closed"],
      shipment_destination_type: ["pickup_point", "home"],
      shipment_return_status: [
        "pending_verification",
        "en_verification",
        "validated",
        "dommage",
        "nettoyage",
        "nettoyage_leger",
        "rejected",
      ],
      shipment_status: [
        "pending",
        "ready",
        "dropped",
        "in_transit",
        "delivered",
        "returned",
        "en_verification",
        "return_validated",
        "failed",
        "closed",
      ],
      user_status: ["active", "suspended", "blocked", "deleted"],
    },
  },
} as const
