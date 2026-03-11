export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      item_brands: {
        Row: {
          id: string;
          label: string;
        };
        Insert: {
          id?: string;
          label: string;
        };
        Update: {
          id?: string;
          label?: string;
        };
        Relationships: [];
      };
      sizes: {
        Row: {
          id: string;
          code: string;
          label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Insert: {
          id?: string;
          code: string;
          label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          first_name: string | null;
          last_name: string | null;
          locale: string | null;
          timezone: string | null;
          onboarding_completed_at: string | null;
        };
        Insert: {
          id: string;
          created_at?: string;
          updated_at?: string;
          first_name?: string | null;
          last_name?: string | null;
          locale?: string | null;
          timezone?: string | null;
          onboarding_completed_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          first_name?: string | null;
          last_name?: string | null;
          locale?: string | null;
          timezone?: string | null;
          onboarding_completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_sessions: {
        Row: {
          id: string;
          user_id: string;
          created_at: string;
          updated_at: string;
          status: "in_progress" | "draft" | "completed" | "abandoned";
          current_step: string;
          progress: Json;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          created_at?: string;
          updated_at?: string;
          status?: "in_progress" | "draft" | "completed" | "abandoned";
          current_step?: string;
          progress?: Json;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
          status?: "in_progress" | "draft" | "completed" | "abandoned";
          current_step?: string;
          progress?: Json;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      upsert_onboarding_progress: {
        Args: {
          p_current_step: string;
          p_progress_json: Json;
          p_request_id: string;
        };
        Returns: Database["public"]["Tables"]["onboarding_sessions"]["Row"];
      };
      complete_onboarding: {
        Args: {
          p_answers_json: Json;
          p_visibility_json: Json;
          p_request_id: string | null;
        };
        Returns: Database["public"]["Tables"]["onboarding_sessions"]["Row"];
      };
      accept_user_consent: {
        Args: {
          p_consent_type: string;
          p_version: string;
          p_granted: boolean;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      update_user_profile_public: {
        Args: {
          p_profile_json: Json;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      set_user_profile_brands: {
        Args: {
          p_brand_ids: string[];
          p_request_id: string | null;
        };
        Returns: Json;
      };
      set_user_profile_sizes: {
        Args: {
          p_top_size_code: string | null;
          p_bottom_size_code: string | null;
          p_shoes_size_code: string | null;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      get_profile_preference_visibility: {
        Args: Record<string, never>;
        Returns: Json;
      };
      set_profile_preference_visibility: {
        Args: {
          p_section: string;
          p_visible: boolean;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      set_user_phone_verified: {
        Args: {
          p_phone_e164: string;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      set_user_birth_date: {
        Args: {
          p_birth_date: string;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      set_user_location: {
        Args: {
          p_adress: string;
          p_timezone: string | null;
          p_relative_city: string | null;
          p_request_id: string | null;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
