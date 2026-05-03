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
      admin_access: {
        Row: {
          admin_key: string
          created_at: string
          link_group_id: string
        }
        Insert: {
          admin_key?: string
          created_at?: string
          link_group_id: string
        }
        Update: {
          admin_key?: string
          created_at?: string
          link_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_access_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: true
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_chat_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read_by_super: boolean
          read_by_tenant: boolean
          sender: string
          tenant_telegram_id: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_by_super?: boolean
          read_by_tenant?: boolean
          sender: string
          tenant_telegram_id: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_by_super?: boolean
          read_by_tenant?: boolean
          sender?: string
          tenant_telegram_id?: number
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      applications: {
        Row: {
          created_at: string
          data: Json
          id: string
          link_group_id: string | null
          listing_id: string | null
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          link_group_id?: string | null
          listing_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          link_group_id?: string | null
          listing_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: false
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_state: {
        Row: {
          data: Json
          state: string
          telegram_id: number
          updated_at: string
        }
        Insert: {
          data?: Json
          state: string
          telegram_id: number
          updated_at?: string
        }
        Update: {
          data?: Json
          state?: string
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      bot_users: {
        Row: {
          created_at: string
          credits_remaining: number
          first_name: string | null
          id: string
          is_admin: boolean
          is_allowed: boolean
          last_name: string | null
          telegram_id: number
          username: string | null
        }
        Insert: {
          created_at?: string
          credits_remaining?: number
          first_name?: string | null
          id?: string
          is_admin?: boolean
          is_allowed?: boolean
          last_name?: string | null
          telegram_id: number
          username?: string | null
        }
        Update: {
          created_at?: string
          credits_remaining?: number
          first_name?: string | null
          id?: string
          is_admin?: boolean
          is_allowed?: boolean
          last_name?: string | null
          telegram_id?: number
          username?: string | null
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          body: string
          created_at: string
          failed_count: number
          id: string
          sent_count: number
        }
        Insert: {
          body: string
          created_at?: string
          failed_count?: number
          id?: string
          sent_count?: number
        }
        Update: {
          body?: string
          created_at?: string
          failed_count?: number
          id?: string
          sent_count?: number
        }
        Relationships: []
      }
      fetched_listings: {
        Row: {
          address: string | null
          baths: number | null
          beds: number | null
          created_at: string
          description: string | null
          id: string
          owner_telegram_id: number
          photos: Json
          price: number | null
          property_type: string | null
          search_zip: string | null
          source: string | null
          source_url: string
          sqft: number | null
          status: string
        }
        Insert: {
          address?: string | null
          baths?: number | null
          beds?: number | null
          created_at?: string
          description?: string | null
          id?: string
          owner_telegram_id: number
          photos?: Json
          price?: number | null
          property_type?: string | null
          search_zip?: string | null
          source?: string | null
          source_url: string
          sqft?: number | null
          status?: string
        }
        Update: {
          address?: string | null
          baths?: number | null
          beds?: number | null
          created_at?: string
          description?: string | null
          id?: string
          owner_telegram_id?: number
          photos?: Json
          price?: number | null
          property_type?: string | null
          search_zip?: string | null
          source?: string | null
          source_url?: string
          sqft?: number | null
          status?: string
        }
        Relationships: []
      }
      link_groups: {
        Row: {
          created_at: string
          id: string
          owner_telegram_id: number
          slug: string
          title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          owner_telegram_id: number
          slug: string
          title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          owner_telegram_id?: number
          slug?: string
          title?: string | null
        }
        Relationships: []
      }
      listing_interests: {
        Row: {
          created_at: string
          id: string
          is_interested: boolean
          listing_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_interested: boolean
          listing_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_interested?: boolean
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_interests_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_photos: {
        Row: {
          created_at: string
          id: string
          is_hidden: boolean
          listing_id: string
          position: number
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_hidden?: boolean
          listing_id: string
          position?: number
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_hidden?: boolean
          listing_id?: string
          position?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          address: string | null
          application_fee: number | null
          baths: number | null
          beds: number | null
          bio: string | null
          created_at: string
          deposit: number | null
          description: string | null
          heading: string | null
          id: string
          link_group_id: string
          position: number
          price: number | null
          property_type: string | null
          source_url: string
          sqft: number | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          application_fee?: number | null
          baths?: number | null
          beds?: number | null
          bio?: string | null
          created_at?: string
          deposit?: number | null
          description?: string | null
          heading?: string | null
          id?: string
          link_group_id: string
          position?: number
          price?: number | null
          property_type?: string | null
          source_url: string
          sqft?: number | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          application_fee?: number | null
          baths?: number | null
          beds?: number | null
          bio?: string | null
          created_at?: string
          deposit?: number | null
          description?: string | null
          heading?: string | null
          id?: string
          link_group_id?: string
          position?: number
          price?: number | null
          property_type?: string | null
          source_url?: string
          sqft?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: false
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_logs: {
        Row: {
          browser: string | null
          city: string | null
          country: string | null
          created_at: string
          device: string | null
          id: string
          ip: string | null
          link_group_id: string | null
          os: string | null
          referrer: string | null
          region: string | null
          slug: string | null
          user_agent: string | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device?: string | null
          id?: string
          ip?: string | null
          link_group_id?: string | null
          os?: string | null
          referrer?: string | null
          region?: string | null
          slug?: string | null
          user_agent?: string | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device?: string | null
          id?: string
          ip?: string | null
          link_group_id?: string | null
          os?: string | null
          referrer?: string | null
          region?: string | null
          slug?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
