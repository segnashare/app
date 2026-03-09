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
          status: "draft" | "completed" | "abandoned";
          current_step: string;
          progress: Json;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          created_at?: string;
          updated_at?: string;
          status?: "draft" | "completed" | "abandoned";
          current_step?: string;
          progress?: Json;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
          status?: "draft" | "completed" | "abandoned";
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
      save_onboarding_progress: {
        Args: {
          p_current_step: string;
          p_progress: Json;
        };
        Returns: Database["public"]["Tables"]["onboarding_sessions"]["Row"];
      };
      complete_onboarding: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["onboarding_sessions"]["Row"];
      };
      get_or_create_user_data: {
        Args: Record<string, never>;
        Returns: Json;
      };
      set_user_data_visibility: {
        Args: {
          p_section: string;
          p_visible: boolean;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
