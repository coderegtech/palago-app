export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      assistants: {
        Row: {
          created_at: string
          id: string
          name: string
          operator_id: string
          phone: string | null
          status: Database["public"]["Enums"]["staff_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          operator_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["staff_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          operator_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["staff_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistants_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      bus_seats: {
        Row: {
          bus_id: string
          column_number: number
          created_at: string
          id: string
          is_aisle: boolean
          is_window: boolean
          row_number: number
          seat_number: string
          seat_type: Database["public"]["Enums"]["seat_type"]
          status: Database["public"]["Enums"]["operator_status"]
        }
        Insert: {
          bus_id: string
          column_number: number
          created_at?: string
          id?: string
          is_aisle?: boolean
          is_window?: boolean
          row_number: number
          seat_number: string
          seat_type?: Database["public"]["Enums"]["seat_type"]
          status?: Database["public"]["Enums"]["operator_status"]
        }
        Update: {
          bus_id?: string
          column_number?: number
          created_at?: string
          id?: string
          is_aisle?: boolean
          is_window?: boolean
          row_number?: number
          seat_number?: string
          seat_type?: Database["public"]["Enums"]["seat_type"]
          status?: Database["public"]["Enums"]["operator_status"]
        }
        Relationships: [
          {
            foreignKeyName: "bus_seats_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
        ]
      }
      buses: {
        Row: {
          bus_number: string
          bus_type: Database["public"]["Enums"]["bus_type"]
          capacity: number
          created_at: string
          id: string
          name: string | null
          operator_id: string
          plate_number: string
          status: Database["public"]["Enums"]["operator_status"]
          updated_at: string
        }
        Insert: {
          bus_number: string
          bus_type?: Database["public"]["Enums"]["bus_type"]
          capacity: number
          created_at?: string
          id?: string
          name?: string | null
          operator_id: string
          plate_number: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Update: {
          bus_number?: string
          bus_type?: Database["public"]["Enums"]["bus_type"]
          capacity?: number
          created_at?: string
          id?: string
          name?: string | null
          operator_id?: string
          plate_number?: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buses_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          id: string
          license_number: string
          name: string
          operator_id: string
          phone: string | null
          status: Database["public"]["Enums"]["staff_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          license_number: string
          name: string
          operator_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["staff_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          license_number?: string
          name?: string
          operator_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["staff_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          status: Database["public"]["Enums"]["operator_status"]
          updated_at: string
        }
        Insert: {
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          id: string
          operator_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id: string
          operator_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id?: string
          operator_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          created_at: string
          destination_terminal_id: string
          distance_km: number | null
          duration_minutes: number
          id: string
          operator_id: string
          origin_terminal_id: string
          status: Database["public"]["Enums"]["operator_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          destination_terminal_id: string
          distance_km?: number | null
          duration_minutes: number
          id?: string
          operator_id: string
          origin_terminal_id: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          destination_terminal_id?: string
          distance_km?: number | null
          duration_minutes?: number
          id?: string
          operator_id?: string
          origin_terminal_id?: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_destination_terminal_id_fkey"
            columns: ["destination_terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_origin_terminal_id_fkey"
            columns: ["origin_terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      terminals: {
        Row: {
          address: string | null
          city: string
          code: string
          created_at: string
          id: string
          latitude: number
          longitude: number
          name: string
          province: string
          status: Database["public"]["Enums"]["operator_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          city: string
          code: string
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          name: string
          province?: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string
          code?: string
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          province?: string
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Relationships: []
      }
      trip_assignments: {
        Row: {
          assigned_at: string
          assistant_id: string | null
          created_at: string
          driver_id: string | null
          id: string
          status: Database["public"]["Enums"]["assignment_status"]
          trip_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assistant_id?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          trip_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assistant_id?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_assignments_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_assignments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_seats: {
        Row: {
          booking_id: string | null
          confirmed_at: string | null
          created_at: string
          held_by: string | null
          held_until: string | null
          id: string
          seat_id: string
          status: Database["public"]["Enums"]["trip_seat_status"]
          trip_id: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          held_by?: string | null
          held_until?: string | null
          id?: string
          seat_id: string
          status?: Database["public"]["Enums"]["trip_seat_status"]
          trip_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          held_by?: string | null
          held_until?: string | null
          id?: string
          seat_id?: string
          status?: Database["public"]["Enums"]["trip_seat_status"]
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_seats_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "bus_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_seats_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          arrival_time: string
          bus_id: string
          created_at: string
          departure_date: string
          departure_time: string
          fare: number
          id: string
          operator_id: string
          route_id: string
          status: Database["public"]["Enums"]["trip_status"]
          trip_number: string
          updated_at: string
        }
        Insert: {
          arrival_time: string
          bus_id: string
          created_at?: string
          departure_date: string
          departure_time: string
          fare: number
          id?: string
          operator_id: string
          route_id: string
          status?: Database["public"]["Enums"]["trip_status"]
          trip_number: string
          updated_at?: string
        }
        Update: {
          arrival_time?: string
          bus_id?: string
          created_at?: string
          departure_date?: string
          departure_time?: string
          fare?: number
          id?: string
          operator_id?: string
          route_id?: string
          status?: Database["public"]["Enums"]["trip_status"]
          trip_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_assistant_id: { Args: never; Returns: string }
      current_driver_id: { Args: never; Returns: string }
      current_operator_id: { Args: never; Returns: string }
      current_profile_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      trip_available_seats: { Args: { p_trip_id: string }; Returns: number }
    }
    Enums: {
      assignment_status: "ASSIGNED" | "ACTIVE" | "COMPLETED" | "CANCELLED"
      bus_type: "BUS" | "RORO"
      operator_status: "ACTIVE" | "INACTIVE"
      seat_type: "REGULAR" | "PRIORITY" | "DRIVER" | "RESERVED"
      staff_status: "ACTIVE" | "INACTIVE" | "SUSPENDED"
      trip_seat_status: "AVAILABLE" | "HELD" | "BOOKED" | "BLOCKED"
      trip_status:
        | "SCHEDULED"
        | "BOARDING"
        | "DEPARTED"
        | "ON_TRIP"
        | "ARRIVED"
        | "COMPLETED"
        | "CANCELLED"
      user_role: "USER" | "OPERATOR" | "DRIVER" | "ASSISTANT" | "ADMIN"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      assignment_status: ["ASSIGNED", "ACTIVE", "COMPLETED", "CANCELLED"],
      bus_type: ["BUS", "RORO"],
      operator_status: ["ACTIVE", "INACTIVE"],
      seat_type: ["REGULAR", "PRIORITY", "DRIVER", "RESERVED"],
      staff_status: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      trip_seat_status: ["AVAILABLE", "HELD", "BOOKED", "BLOCKED"],
      trip_status: [
        "SCHEDULED",
        "BOARDING",
        "DEPARTED",
        "ON_TRIP",
        "ARRIVED",
        "COMPLETED",
        "CANCELLED",
      ],
      user_role: ["USER", "OPERATOR", "DRIVER", "ASSISTANT", "ADMIN"],
    },
  },
} as const

