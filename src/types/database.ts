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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      assistants: {
        Row: {
          availability_status: Database["public"]["Enums"]["availability_status"]
          created_at: string
          id: string
          name: string
          operator_id: string
          phone: string | null
          unavailable_reason: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          availability_status?: Database["public"]["Enums"]["availability_status"]
          created_at?: string
          id?: string
          name: string
          operator_id: string
          phone?: string | null
          unavailable_reason?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          availability_status?: Database["public"]["Enums"]["availability_status"]
          created_at?: string
          id?: string
          name?: string
          operator_id?: string
          phone?: string | null
          unavailable_reason?: string | null
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
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      booking_passengers: {
        Row: {
          boarded_at: string | null
          boarded_by: string | null
          booking_id: string
          created_at: string
          discount_amount: number
          discount_kind: Database["public"]["Enums"]["discount_kind"] | null
          email: string | null
          id: string
          passenger_name: string
          passenger_type: Database["public"]["Enums"]["passenger_type"]
          phone: string | null
          seat_id: string | null
          user_id: string | null
        }
        Insert: {
          boarded_at?: string | null
          boarded_by?: string | null
          booking_id: string
          created_at?: string
          discount_amount?: number
          discount_kind?: Database["public"]["Enums"]["discount_kind"] | null
          email?: string | null
          id?: string
          passenger_name: string
          passenger_type?: Database["public"]["Enums"]["passenger_type"]
          phone?: string | null
          seat_id?: string | null
          user_id?: string | null
        }
        Update: {
          boarded_at?: string | null
          boarded_by?: string | null
          booking_id?: string
          created_at?: string
          discount_amount?: number
          discount_kind?: Database["public"]["Enums"]["discount_kind"] | null
          email?: string | null
          id?: string
          passenger_name?: string
          passenger_type?: Database["public"]["Enums"]["passenger_type"]
          phone?: string | null
          seat_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_passengers_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "bus_seats"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          boarded_at: string | null
          booking_reference: string
          cancelled_at: string | null
          checked_in_at: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          discount: number
          expires_at: string | null
          id: string
          loyalty_discount: number
          source: Database["public"]["Enums"]["booking_source"]
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          ticket_type: Database["public"]["Enums"]["ticket_type"]
          total_amount: number
          trip_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          boarded_at?: string | null
          booking_reference?: string
          cancelled_at?: string | null
          checked_in_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount?: number
          expires_at?: string | null
          id?: string
          loyalty_discount?: number
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          ticket_type?: Database["public"]["Enums"]["ticket_type"]
          total_amount: number
          trip_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          boarded_at?: string | null
          booking_reference?: string
          cancelled_at?: string | null
          checked_in_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount?: number
          expires_at?: string | null
          id?: string
          loyalty_discount?: number
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number
          ticket_type?: Database["public"]["Enums"]["ticket_type"]
          total_amount?: number
          trip_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      bus_locations: {
        Row: {
          accuracy_m: number | null
          created_at: string
          driver_id: string
          heading: number | null
          id: string
          latitude: number
          longitude: number
          recorded_at: string
          speed_kph: number | null
          trip_id: string
        }
        Insert: {
          accuracy_m?: number | null
          created_at?: string
          driver_id?: string
          heading?: number | null
          id?: string
          latitude: number
          longitude: number
          recorded_at?: string
          speed_kph?: number | null
          trip_id: string
        }
        Update: {
          accuracy_m?: number | null
          created_at?: string
          driver_id?: string
          heading?: number | null
          id?: string
          latitude?: number
          longitude?: number
          recorded_at?: string
          speed_kph?: number | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bus_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "bus_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bus_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bus_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
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
          {
            foreignKeyName: "bus_seats_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_seats_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["bus_id"]
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
      discount_eligibilities: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["discount_kind"]
          proof_path: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["eligibility_status"]
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["discount_kind"]
          proof_path: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["eligibility_status"]
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["discount_kind"]
          proof_path?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["eligibility_status"]
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          availability_status: Database["public"]["Enums"]["availability_status"]
          created_at: string
          id: string
          license_expiration_date: string | null
          license_number: string
          name: string
          operator_id: string
          phone: string | null
          unavailable_reason: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          availability_status?: Database["public"]["Enums"]["availability_status"]
          created_at?: string
          id?: string
          license_expiration_date?: string | null
          license_number: string
          name: string
          operator_id: string
          phone?: string | null
          unavailable_reason?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          availability_status?: Database["public"]["Enums"]["availability_status"]
          created_at?: string
          id?: string
          license_expiration_date?: string | null
          license_number?: string
          name?: string
          operator_id?: string
          phone?: string | null
          unavailable_reason?: string | null
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
      loyalty_accounts: {
        Row: {
          created_at: string
          id: string
          lifetime_points: number
          points_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lifetime_points?: number
          points_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lifetime_points?: number
          points_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          balance_after: number
          balance_before: number
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          points: number
          reference: string | null
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id: string
        }
        Insert: {
          balance_after: number
          balance_before: number
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          points: number
          reference?: string | null
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id: string
        }
        Update: {
          balance_after?: number
          balance_before?: number
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          points?: number
          reference?: string | null
          type?: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          message: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          message: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          message?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
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
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          metadata: Json | null
          payment_id: string
          reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          type: Database["public"]["Enums"]["payment_transaction_type"]
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          metadata?: Json | null
          payment_id: string
          reference?: string | null
          status: Database["public"]["Enums"]["payment_status"]
          type: Database["public"]["Enums"]["payment_transaction_type"]
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          payment_id?: string
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          type?: Database["public"]["Enums"]["payment_transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          cancelled_at: string | null
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"] | null
          paid_at: string | null
          payment_url: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          receipt_number: string | null
          received_by: string | null
          reference: string
          refunded_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          token: string
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"] | null
          paid_at?: string | null
          payment_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          receipt_number?: string | null
          received_by?: string | null
          reference?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          token?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"] | null
          paid_at?: string | null
          payment_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          receipt_number?: string | null
          received_by?: string | null
          reference?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          avatar_url: string | null
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          id: string
          is_test_account: boolean
          must_change_password: boolean
          operator_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          avatar_url?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id: string
          is_test_account?: boolean
          must_change_password?: boolean
          operator_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          avatar_url?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id?: string
          is_test_account?: boolean
          must_change_password?: boolean
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
      push_tokens: {
        Row: {
          created_at: string
          device_name: string | null
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      qr_scans: {
        Row: {
          booking_id: string | null
          bus_id: string | null
          id: string
          operator_user_id: string
          result: string
          scan_method: Database["public"]["Enums"]["scan_method"]
          scan_type: Database["public"]["Enums"]["scan_type"]
          scanned_at: string
          ticket_trip_id: string | null
          trip_id: string | null
        }
        Insert: {
          booking_id?: string | null
          bus_id?: string | null
          id?: string
          operator_user_id: string
          result: string
          scan_method?: Database["public"]["Enums"]["scan_method"]
          scan_type: Database["public"]["Enums"]["scan_type"]
          scanned_at?: string
          ticket_trip_id?: string | null
          trip_id?: string | null
        }
        Update: {
          booking_id?: string | null
          bus_id?: string | null
          id?: string
          operator_user_id?: string
          result?: string
          scan_method?: Database["public"]["Enums"]["scan_method"]
          scan_type?: Database["public"]["Enums"]["scan_type"]
          scanned_at?: string
          ticket_trip_id?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_scans_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "qr_scans_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["bus_id"]
          },
          {
            foreignKeyName: "qr_scans_ticket_trip_id_fkey"
            columns: ["ticket_trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "qr_scans_ticket_trip_id_fkey"
            columns: ["ticket_trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_ticket_trip_id_fkey"
            columns: ["ticket_trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "qr_scans_ticket_trip_id_fkey"
            columns: ["ticket_trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_ticket_trip_id_fkey"
            columns: ["ticket_trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "qr_scans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "qr_scans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          amount: number
          booking_id: string
          currency: string
          id: string
          issued_at: string
          payment_id: string
          payment_method: string
          receipt_number: string
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount: number
          booking_id: string
          currency?: string
          id?: string
          issued_at?: string
          payment_id: string
          payment_method?: string
          receipt_number?: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount?: number
          booking_id?: string
          currency?: string
          id?: string
          issued_at?: string
          payment_id?: string
          payment_method?: string
          receipt_number?: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "receipts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_redemptions: {
        Row: {
          booking_id: string
          cancelled_at: string | null
          discount_applied: number
          id: string
          points_used: number
          redeemed_at: string
          reward_id: string
          status: Database["public"]["Enums"]["operator_status"]
          user_id: string
        }
        Insert: {
          booking_id: string
          cancelled_at?: string | null
          discount_applied: number
          id?: string
          points_used: number
          redeemed_at?: string
          reward_id: string
          status?: Database["public"]["Enums"]["operator_status"]
          user_id: string
        }
        Update: {
          booking_id?: string
          cancelled_at?: string | null
          discount_applied?: number
          id?: string
          points_used?: number
          redeemed_at?: string
          reward_id?: string
          status?: Database["public"]["Enums"]["operator_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards: {
        Row: {
          code: string
          created_at: string
          description: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          id: string
          max_discount: number | null
          name: string
          points_required: number
          status: Database["public"]["Enums"]["operator_status"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          id?: string
          max_discount?: number | null
          name: string
          points_required: number
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          id?: string
          max_discount?: number | null
          name?: string
          points_required?: number
          status?: Database["public"]["Enums"]["operator_status"]
          updated_at?: string
        }
        Relationships: []
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
      sos_incidents: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          booking_id: string | null
          created_at: string
          id: string
          latitude: number
          longitude: number
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          responding_at: string | null
          status: Database["public"]["Enums"]["sos_status"]
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          booking_id?: string | null
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responding_at?: string | null
          status?: Database["public"]["Enums"]["sos_status"]
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          booking_id?: string | null
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responding_at?: string | null
          status?: Database["public"]["Enums"]["sos_status"]
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
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
          blocked_range: unknown
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
          blocked_range: unknown
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
          blocked_range?: unknown
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
            foreignKeyName: "trip_assignments_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["assistant_id"]
          },
          {
            foreignKeyName: "trip_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "trip_assignments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "trip_assignments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_assignments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "trip_assignments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
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
            foreignKeyName: "trip_seats_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_seats_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
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
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "trip_seats_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_seats_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "trip_seats_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
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
          actual_arrival_at: string | null
          actual_departure_at: string | null
          arrival_at: string
          arrival_time: string
          blocked_range: unknown
          bus_id: string
          cancelled_by: string | null
          cancelled_reason: string | null
          completed_by: string | null
          created_at: string
          departure_at: string
          departure_date: string
          departure_time: string
          fare: number
          id: string
          is_active: boolean
          operator_id: string
          route_id: string
          status: Database["public"]["Enums"]["trip_status"]
          trip_number: string
          updated_at: string
        }
        Insert: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          arrival_at: string
          arrival_time: string
          blocked_range: unknown
          bus_id: string
          cancelled_by?: string | null
          cancelled_reason?: string | null
          completed_by?: string | null
          created_at?: string
          departure_at: string
          departure_date: string
          departure_time: string
          fare: number
          id?: string
          is_active?: boolean
          operator_id: string
          route_id: string
          status?: Database["public"]["Enums"]["trip_status"]
          trip_number: string
          updated_at?: string
        }
        Update: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          arrival_at?: string
          arrival_time?: string
          blocked_range?: unknown
          bus_id?: string
          cancelled_by?: string | null
          cancelled_reason?: string | null
          completed_by?: string | null
          created_at?: string
          departure_at?: string
          departure_date?: string
          departure_time?: string
          fare?: number
          id?: string
          is_active?: boolean
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
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["bus_id"]
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
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          idempotency_key: string | null
          payment_id: string | null
          reference: string | null
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string | null
          payment_id?: string | null
          reference?: string | null
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string | null
          payment_id?: string | null
          reference?: string | null
          type?: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "wallet_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      driver_assignments: {
        Row: {
          actual_arrival_at: string | null
          actual_departure_at: string | null
          arrival_time: string | null
          assignment_id: string | null
          assignment_status:
            | Database["public"]["Enums"]["assignment_status"]
            | null
          boarded_count: number | null
          bus_number: string | null
          capacity: number | null
          departure_date: string | null
          departure_time: string | null
          destination_code: string | null
          destination_name: string | null
          origin_code: string | null
          origin_name: string | null
          passenger_count: number | null
          plate_number: string | null
          trip_id: string | null
          trip_number: string | null
          trip_status: Database["public"]["Enums"]["trip_status"] | null
        }
        Relationships: []
      }
      operator_crew: {
        Row: {
          account_email: string | null
          account_status: Database["public"]["Enums"]["account_status"] | null
          availability_status:
            | Database["public"]["Enums"]["availability_status"]
            | null
          created_at: string | null
          crew_kind: string | null
          has_account: boolean | null
          id: string | null
          license_expiration_date: string | null
          license_number: string | null
          must_change_password: boolean | null
          name: string | null
          operator_id: string | null
          phone: string | null
          unavailable_reason: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      operator_fleet: {
        Row: {
          bus_number: string | null
          bus_type: Database["public"]["Enums"]["bus_type"] | null
          capacity: number | null
          created_at: string | null
          id: string | null
          name: string | null
          operator_id: string | null
          plate_number: string | null
          status: Database["public"]["Enums"]["operator_status"] | null
        }
        Insert: {
          bus_number?: string | null
          bus_type?: Database["public"]["Enums"]["bus_type"] | null
          capacity?: number | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          operator_id?: string | null
          plate_number?: string | null
          status?: Database["public"]["Enums"]["operator_status"] | null
        }
        Update: {
          bus_number?: string | null
          bus_type?: Database["public"]["Enums"]["bus_type"] | null
          capacity?: number | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          operator_id?: string | null
          plate_number?: string | null
          status?: Database["public"]["Enums"]["operator_status"] | null
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
      operator_manifest: {
        Row: {
          boarded_at: string | null
          booking_id: string | null
          booking_reference: string | null
          booking_status: Database["public"]["Enums"]["booking_status"] | null
          checked_in_at: string | null
          column_number: number | null
          id: string | null
          passenger_name: string | null
          passenger_type: Database["public"]["Enums"]["passenger_type"] | null
          payment_status: string | null
          phone: string | null
          row_number: number | null
          seat_number: string | null
          trip_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_trip_overview: {
        Row: {
          actual_arrival_at: string | null
          actual_departure_at: string | null
          arrival_time: string | null
          assignment_status:
            | Database["public"]["Enums"]["assignment_status"]
            | null
          assistant_id: string | null
          assistant_name: string | null
          assistant_phone: string | null
          boarded_count: number | null
          bus_id: string | null
          bus_number: string | null
          bus_type: Database["public"]["Enums"]["bus_type"] | null
          capacity: number | null
          departure_date: string | null
          departure_delay_minutes: number | null
          departure_time: string | null
          destination_code: string | null
          destination_name: string | null
          driver_id: string | null
          driver_name: string | null
          driver_phone: string | null
          duration_minutes: number | null
          fare: number | null
          id: string | null
          operator_id: string | null
          origin_code: string | null
          origin_name: string | null
          passenger_count: number | null
          revenue: number | null
          seats_available: number | null
          seats_booked: number | null
          seats_held: number | null
          status: Database["public"]["Enums"]["trip_status"] | null
          trip_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_incident_details: {
        Row: {
          acknowledged_at: string | null
          booking_id: string | null
          bus_number: string | null
          created_at: string | null
          departure_at: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          note: string | null
          operator_name: string | null
          passenger_name: string | null
          passenger_phone: string | null
          resolved_at: string | null
          responding_at: string | null
          route_label: string | null
          status: Database["public"]["Enums"]["sos_status"] | null
          trip_id: string | null
          trip_number: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sos_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "operator_manifest"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "driver_assignments"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_live_position"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_live_position: {
        Row: {
          accuracy_m: number | null
          actual_arrival_at: string | null
          actual_departure_at: string | null
          arrival_time: string | null
          bus_number: string | null
          departure_date: string | null
          departure_time: string | null
          destination_code: string | null
          destination_latitude: number | null
          destination_longitude: number | null
          destination_name: string | null
          heading: number | null
          latitude: number | null
          longitude: number | null
          origin_code: string | null
          origin_latitude: number | null
          origin_longitude: number | null
          origin_name: string | null
          plate_number: string | null
          recorded_at: string | null
          speed_kph: number | null
          trip_id: string | null
          trip_number: string | null
          trip_status: Database["public"]["Enums"]["trip_status"] | null
        }
        Relationships: []
      }
      trip_search: {
        Row: {
          arrival_at: string | null
          arrival_time: string | null
          available_seats: number | null
          bus_id: string | null
          bus_number: string | null
          bus_status: Database["public"]["Enums"]["operator_status"] | null
          bus_type: Database["public"]["Enums"]["bus_type"] | null
          capacity: number | null
          departure_at: string | null
          departure_date: string | null
          departure_time: string | null
          destination_city: string | null
          destination_code: string | null
          destination_name: string | null
          destination_terminal_id: string | null
          distance_km: number | null
          duration_minutes: number | null
          fare: number | null
          id: string | null
          is_active: boolean | null
          operator_code: string | null
          operator_id: string | null
          operator_name: string | null
          operator_status: Database["public"]["Enums"]["operator_status"] | null
          origin_city: string | null
          origin_code: string | null
          origin_name: string | null
          origin_terminal_id: string | null
          route_id: string | null
          route_status: Database["public"]["Enums"]["operator_status"] | null
          status: Database["public"]["Enums"]["trip_status"] | null
          trip_number: string | null
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
            foreignKeyName: "routes_origin_terminal_id_fkey"
            columns: ["origin_terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "operator_trip_overview"
            referencedColumns: ["bus_id"]
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
    Functions: {
      acknowledge_sos: { Args: { p_sos_id: string }; Returns: Json }
      active_discount_kind: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["discount_kind"]
      }
      active_uid: { Args: never; Returns: string }
      admin_dashboard: { Args: { p_date?: string }; Returns: Json }
      assign_seats_for_booking: {
        Args: { p_booking_id: string }
        Returns: number
      }
      assign_trip_crew: {
        Args: {
          p_assistant_id?: string
          p_driver_id?: string
          p_trip_id: string
        }
        Returns: Json
      }
      authorize_staff_manage: { Args: { p_user_id: string }; Returns: Json }
      authorize_staff_provision: {
        Args: {
          p_operator_id: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: Json
      }
      award_loyalty_for_booking: {
        Args: { p_booking_id: string }
        Returns: number
      }
      boarding_verdict: {
        Args: {
          p_booking: Database["public"]["Tables"]["bookings"]["Row"]
          p_door: Database["public"]["Tables"]["trips"]["Row"]
        }
        Returns: string
      }
      can_manage_operator: { Args: { p_operator_id: string }; Returns: boolean }
      can_manage_sos: { Args: { p_trip_id: string }; Returns: boolean }
      can_manage_trip_status: { Args: { p_trip_id: string }; Returns: boolean }
      can_publish_location: { Args: { p_trip_id: string }; Returns: boolean }
      can_scan_trip: { Args: { p_trip_id: string }; Returns: boolean }
      can_track_trip: { Args: { p_trip_id: string }; Returns: boolean }
      cancel_booking: { Args: { p_booking_id: string }; Returns: Json }
      cancel_reward_redemption: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      cancel_sos: { Args: { p_sos_id: string }; Returns: Json }
      cancel_trip: {
        Args: { p_reason?: string; p_trip_id: string }
        Returns: Json
      }
      confirm_boarding: {
        Args: {
          p_booking_id: string
          p_method?: Database["public"]["Enums"]["scan_method"]
          p_passenger_ids?: string[]
          p_trip_id: string
        }
        Returns: Json
      }
      confirm_test_payment: {
        Args: { p_ip_address?: string; p_reference: string; p_token: string }
        Returns: Json
      }
      create_booking: {
        Args: {
          p_passengers: Json
          p_seat_ids?: string[]
          p_source?: Database["public"]["Enums"]["booking_source"]
          p_ticket_type?: Database["public"]["Enums"]["ticket_type"]
          p_trip_id: string
          p_walk_in?: boolean
        }
        Returns: Json
      }
      create_bus: {
        Args: {
          p_bus_number: string
          p_bus_type?: Database["public"]["Enums"]["bus_type"]
          p_capacity: number
          p_name?: string
          p_operator_id: string
          p_plate_number: string
        }
        Returns: Json
      }
      create_crew_member: {
        Args: {
          p_kind: string
          p_license_expiration_date?: string
          p_license_number?: string
          p_name: string
          p_operator_id?: string
          p_phone?: string
        }
        Returns: Json
      }
      create_operator: {
        Args: {
          p_code: string
          p_contact_email?: string
          p_contact_phone?: string
          p_description?: string
          p_name: string
        }
        Returns: Json
      }
      create_route: {
        Args: {
          p_destination_terminal_id: string
          p_distance_km?: number
          p_duration_minutes: number
          p_operator_id: string
          p_origin_terminal_id: string
        }
        Returns: Json
      }
      create_terminal: {
        Args: {
          p_address?: string
          p_city: string
          p_code: string
          p_latitude: number
          p_longitude: number
          p_name: string
          p_province?: string
        }
        Returns: Json
      }
      create_test_payment: { Args: { p_booking_id: string }; Returns: Json }
      create_trip: {
        Args: {
          p_arrival_time: string
          p_bus_id: string
          p_departure_date: string
          p_departure_time: string
          p_fare: number
          p_operator_id?: string
          p_route_id: string
          p_trip_number: string
        }
        Returns: Json
      }
      current_assistant_id: { Args: never; Returns: string }
      current_driver_id: { Args: never; Returns: string }
      current_operator_id: { Args: never; Returns: string }
      current_profile_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      data_reset_preview: { Args: never; Returns: Json }
      delete_bus: { Args: { p_bus_id: string }; Returns: Json }
      delete_operator: { Args: { p_operator_id: string }; Returns: Json }
      delete_trip: { Args: { p_trip_id: string }; Returns: Json }
      discount_rate_bps: { Args: never; Returns: number }
      end_trip: { Args: { p_trip_id: string }; Returns: Json }
      expire_seat_holds: { Args: never; Returns: Json }
      expire_stale_payments: { Args: never; Returns: Json }
      flag_password_reset: { Args: { p_user_id: string }; Returns: Json }
      get_public_payment: {
        Args: { p_reference: string; p_token: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      loyalty_points_for: {
        Args: { p_amount_centavos: number }
        Returns: number
      }
      loyalty_post: {
        Args: {
          p_booking_id?: string
          p_description?: string
          p_points: number
          p_reference?: string
          p_type: Database["public"]["Enums"]["loyalty_transaction_type"]
          p_user_id: string
        }
        Returns: {
          balance_after: number
          balance_before: number
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          points: number
          reference: string | null
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "loyalty_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_password_changed: { Args: never; Returns: Json }
      next_booking_reference: { Args: never; Returns: string }
      next_payment_reference: { Args: never; Returns: string }
      next_receipt_number: { Args: never; Returns: string }
      operator_dashboard: { Args: { p_date?: string }; Returns: Json }
      pay_booking_with_wallet: { Args: { p_booking_id: string }; Returns: Json }
      provision_staff_account: {
        Args: {
          p_crew_id?: string
          p_full_name: string
          p_license_expiration_date?: string
          p_license_number?: string
          p_operator_id: string
          p_phone?: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: Json
      }
      public_setting: { Args: { p_key: string }; Returns: string }
      record_counter_payment: {
        Args: {
          p_booking_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: Json
      }
      redeem_reward: {
        Args: { p_booking_id: string; p_reward_id: string }
        Returns: Json
      }
      refund_test_payment: { Args: { p_booking_id: string }; Returns: Json }
      register_push_token: {
        Args: { p_device_name?: string; p_platform: string; p_token: string }
        Returns: Json
      }
      release_booking_redemption: {
        Args: { p_booking_id: string }
        Returns: number
      }
      remove_push_token: { Args: { p_token: string }; Returns: Json }
      reset_application_data: {
        Args: { p_confirmation: string }
        Returns: Json
      }
      resolve_sos: {
        Args: { p_note?: string; p_sos_id: string }
        Returns: Json
      }
      respond_sos: { Args: { p_sos_id: string }; Returns: Json }
      review_discount_eligibility: {
        Args: {
          p_approve: boolean
          p_expires_at?: string
          p_id: string
          p_note?: string
        }
        Returns: Json
      }
      set_account_status: {
        Args: {
          p_reason?: string
          p_status: Database["public"]["Enums"]["account_status"]
          p_user_id: string
        }
        Returns: Json
      }
      set_bus_status: {
        Args: {
          p_bus_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["operator_status"]
        }
        Returns: Json
      }
      set_crew_availability: {
        Args: {
          p_crew_id: string
          p_kind: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["availability_status"]
        }
        Returns: Json
      }
      set_my_availability: {
        Args: {
          p_reason?: string
          p_status: Database["public"]["Enums"]["availability_status"]
        }
        Returns: Json
      }
      set_operator_status: {
        Args: {
          p_operator_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["operator_status"]
        }
        Returns: Json
      }
      set_payment_url: {
        Args: { p_payment_id: string; p_payment_url: string }
        Returns: undefined
      }
      set_route_status: {
        Args: {
          p_route_id: string
          p_status: Database["public"]["Enums"]["operator_status"]
        }
        Returns: Json
      }
      set_terminal_status: {
        Args: {
          p_status: Database["public"]["Enums"]["operator_status"]
          p_terminal_id: string
        }
        Returns: Json
      }
      set_trip_active: {
        Args: { p_active: boolean; p_trip_id: string }
        Returns: Json
      }
      set_trip_boarding: { Args: { p_trip_id: string }; Returns: Json }
      set_turnaround_minutes: { Args: { p_minutes: number }; Returns: Json }
      sos_advance: {
        Args: {
          p_from: Database["public"]["Enums"]["sos_status"][]
          p_note?: string
          p_sos_id: string
          p_to: Database["public"]["Enums"]["sos_status"]
        }
        Returns: Json
      }
      sos_responder_ids: { Args: { p_trip_id: string }; Returns: string[] }
      staff_activity: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: Json
      }
      start_trip: { Args: { p_trip_id: string }; Returns: Json }
      submit_discount_proof: {
        Args: {
          p_kind: Database["public"]["Enums"]["discount_kind"]
          p_proof_path: string
        }
        Returns: Json
      }
      top_up_wallet: {
        Args: { p_amount: number; p_idempotency_key?: string }
        Returns: Json
      }
      trigger_sos: {
        Args: { p_booking_id?: string; p_latitude: number; p_longitude: number }
        Returns: Json
      }
      trip_arrival_timestamp: {
        Args: { p_arrival: string; p_date: string; p_departure: string }
        Returns: string
      }
      trip_available_seats: { Args: { p_trip_id: string }; Returns: number }
      turnaround_minutes: { Args: never; Returns: number }
      unassign_trip_crew: { Args: { p_trip_id: string }; Returns: Json }
      update_bus: {
        Args: {
          p_bus_id: string
          p_bus_number: string
          p_name?: string
          p_operator_id?: string
          p_plate_number: string
        }
        Returns: Json
      }
      update_crew_member: {
        Args: {
          p_crew_id: string
          p_kind: string
          p_license_expiration_date?: string
          p_license_number?: string
          p_name: string
          p_phone?: string
        }
        Returns: Json
      }
      update_operator: {
        Args: {
          p_contact_email?: string
          p_contact_phone?: string
          p_description?: string
          p_name: string
          p_operator_id: string
        }
        Returns: Json
      }
      update_route: {
        Args: {
          p_distance_km?: number
          p_duration_minutes: number
          p_route_id: string
        }
        Returns: Json
      }
      update_terminal: {
        Args: {
          p_address?: string
          p_city: string
          p_latitude: number
          p_longitude: number
          p_name: string
          p_province?: string
          p_terminal_id: string
        }
        Returns: Json
      }
      update_trip: {
        Args: {
          p_arrival_time: string
          p_bus_id: string
          p_departure_date: string
          p_departure_time: string
          p_fare: number
          p_route_id: string
          p_trip_id: string
          p_trip_number: string
        }
        Returns: Json
      }
      validate_booking_qr: {
        Args: {
          p_booking_id: string
          p_method?: Database["public"]["Enums"]["scan_method"]
          p_reference: string
          p_trip_id: string
        }
        Returns: Json
      }
      wallet_max_balance: { Args: never; Returns: number }
      wallet_max_top_up: { Args: never; Returns: number }
      wallet_post: {
        Args: {
          p_amount: number
          p_booking_id?: string
          p_description?: string
          p_idempotency_key?: string
          p_payment_id?: string
          p_reference?: string
          p_type: Database["public"]["Enums"]["wallet_transaction_type"]
          p_wallet_id: string
        }
        Returns: {
          amount: number
          balance_after: number
          balance_before: number
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          idempotency_key: string | null
          payment_id: string | null
          reference: string | null
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallet_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      account_status: "ACTIVE" | "INACTIVE"
      assignment_status: "ASSIGNED" | "ACTIVE" | "COMPLETED" | "CANCELLED"
      availability_status: "AVAILABLE" | "UNAVAILABLE"
      booking_source: "MOBILE_APP" | "WEB" | "OPERATOR" | "TERMINAL"
      booking_status:
        | "PENDING"
        | "PAYMENT_PENDING"
        | "CONFIRMED"
        | "CHECKED_IN"
        | "BOARDED"
        | "ON_TRIP"
        | "COMPLETED"
        | "CANCELLED"
        | "REFUNDED"
        | "NO_SHOW"
      bus_type: "BUS" | "RORO"
      discount_kind: "SENIOR" | "STUDENT" | "PWD"
      discount_type: "FIXED" | "PERCENTAGE" | "PERK"
      eligibility_status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"
      loyalty_transaction_type:
        | "EARNED"
        | "REDEEMED"
        | "EXPIRED"
        | "ADJUSTED"
        | "BONUS"
      notification_type:
        | "BOOKING_CONFIRMED"
        | "PAYMENT_CONFIRMED"
        | "TRIP_REMINDER"
        | "TRIP_DELAY"
        | "TRIP_CANCELLED"
        | "BOARDING"
        | "SOS"
        | "REWARD"
        | "SYSTEM"
      operator_status: "ACTIVE" | "INACTIVE"
      passenger_type: "ADULT" | "CHILD" | "SENIOR" | "STUDENT" | "PWD"
      payment_method:
        | "CASH"
        | "TEST_GCASH"
        | "TEST_MAYA"
        | "TEST_CARD"
        | "TEST_BANK"
        | "TEST_WALLET"
      payment_provider: "MOCK" | "STRIPE" | "GCASH" | "MAYA" | "CASH"
      payment_status:
        | "PENDING"
        | "PROCESSING"
        | "PAID"
        | "FAILED"
        | "CANCELLED"
        | "REFUNDED"
      payment_transaction_type:
        | "CREATED"
        | "AUTHORIZED"
        | "PAID"
        | "FAILED"
        | "REFUNDED"
        | "CANCELLED"
      scan_method: "QR" | "REFERENCE" | "MANUAL"
      scan_type: "VALIDATION" | "BOARDING"
      seat_type: "REGULAR" | "PRIORITY" | "DRIVER" | "RESERVED"
      sos_status:
        | "ACTIVE"
        | "ACKNOWLEDGED"
        | "RESPONDING"
        | "RESOLVED"
        | "CANCELLED"
      ticket_type: "DIGITAL" | "PRINTED"
      trip_seat_status: "AVAILABLE" | "HELD" | "BOOKED" | "BLOCKED"
      trip_status:
        | "SCHEDULED"
        | "BOARDING"
        | "DEPARTED"
        | "ON_TRIP"
        | "ARRIVED"
        | "COMPLETED"
        | "CANCELLED"
      user_role: "USER" | "OPERATOR_ADMIN" | "DRIVER" | "CREW" | "SUPER_ADMIN"
      wallet_transaction_type:
        | "TOP_UP"
        | "BOOKING_PAYMENT"
        | "REFUND"
        | "REWARD"
        | "ADJUSTMENT"
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
      account_status: ["ACTIVE", "INACTIVE"],
      assignment_status: ["ASSIGNED", "ACTIVE", "COMPLETED", "CANCELLED"],
      availability_status: ["AVAILABLE", "UNAVAILABLE"],
      booking_source: ["MOBILE_APP", "WEB", "OPERATOR", "TERMINAL"],
      booking_status: [
        "PENDING",
        "PAYMENT_PENDING",
        "CONFIRMED",
        "CHECKED_IN",
        "BOARDED",
        "ON_TRIP",
        "COMPLETED",
        "CANCELLED",
        "REFUNDED",
        "NO_SHOW",
      ],
      bus_type: ["BUS", "RORO"],
      discount_kind: ["SENIOR", "STUDENT", "PWD"],
      discount_type: ["FIXED", "PERCENTAGE", "PERK"],
      eligibility_status: ["PENDING", "APPROVED", "REJECTED", "REVOKED"],
      loyalty_transaction_type: [
        "EARNED",
        "REDEEMED",
        "EXPIRED",
        "ADJUSTED",
        "BONUS",
      ],
      notification_type: [
        "BOOKING_CONFIRMED",
        "PAYMENT_CONFIRMED",
        "TRIP_REMINDER",
        "TRIP_DELAY",
        "TRIP_CANCELLED",
        "BOARDING",
        "SOS",
        "REWARD",
        "SYSTEM",
      ],
      operator_status: ["ACTIVE", "INACTIVE"],
      passenger_type: ["ADULT", "CHILD", "SENIOR", "STUDENT", "PWD"],
      payment_method: [
        "CASH",
        "TEST_GCASH",
        "TEST_MAYA",
        "TEST_CARD",
        "TEST_BANK",
        "TEST_WALLET",
      ],
      payment_provider: ["MOCK", "STRIPE", "GCASH", "MAYA", "CASH"],
      payment_status: [
        "PENDING",
        "PROCESSING",
        "PAID",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
      ],
      payment_transaction_type: [
        "CREATED",
        "AUTHORIZED",
        "PAID",
        "FAILED",
        "REFUNDED",
        "CANCELLED",
      ],
      scan_method: ["QR", "REFERENCE", "MANUAL"],
      scan_type: ["VALIDATION", "BOARDING"],
      seat_type: ["REGULAR", "PRIORITY", "DRIVER", "RESERVED"],
      sos_status: [
        "ACTIVE",
        "ACKNOWLEDGED",
        "RESPONDING",
        "RESOLVED",
        "CANCELLED",
      ],
      ticket_type: ["DIGITAL", "PRINTED"],
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
      user_role: ["USER", "OPERATOR_ADMIN", "DRIVER", "CREW", "SUPER_ADMIN"],
      wallet_transaction_type: [
        "TOP_UP",
        "BOOKING_PAYMENT",
        "REFUND",
        "REWARD",
        "ADJUSTMENT",
      ],
    },
  },
} as const

