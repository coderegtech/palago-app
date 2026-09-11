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
          booking_id: string
          created_at: string
          discount_amount: number
          discount_kind: Database["public"]["Enums"]["discount_kind"] | null
          email: string | null
          id: string
          passenger_name: string
          passenger_type: Database["public"]["Enums"]["passenger_type"]
          phone: string | null
          seat_id: string
          user_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          discount_amount?: number
          discount_kind?: Database["public"]["Enums"]["discount_kind"] | null
          email?: string | null
          id?: string
          passenger_name: string
          passenger_type?: Database["public"]["Enums"]["passenger_type"]
          phone?: string | null
          seat_id: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          discount_amount?: number
          discount_kind?: Database["public"]["Enums"]["discount_kind"] | null
          email?: string | null
          id?: string
          passenger_name?: string
          passenger_type?: Database["public"]["Enums"]["passenger_type"]
          phone?: string | null
          seat_id?: string
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
          currency: string
          discount: number
          expires_at: string | null
          id: string
          loyalty_discount: number
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          total_amount: number
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          boarded_at?: string | null
          booking_reference?: string
          cancelled_at?: string | null
          checked_in_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          discount?: number
          expires_at?: string | null
          id?: string
          loyalty_discount?: number
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          total_amount: number
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          boarded_at?: string | null
          booking_reference?: string
          cancelled_at?: string | null
          checked_in_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          discount?: number
          expires_at?: string | null
          id?: string
          loyalty_discount?: number
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number
          total_amount?: number
          trip_id?: string
          updated_at?: string
          user_id?: string
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
          paid_at: string | null
          payment_url: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          receipt_number: string | null
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
          paid_at?: string | null
          payment_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          receipt_number?: string | null
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
          paid_at?: string | null
          payment_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          receipt_number?: string | null
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
      qr_scans: {
        Row: {
          booking_id: string | null
          id: string
          operator_user_id: string
          result: string
          scan_type: Database["public"]["Enums"]["scan_type"]
          scanned_at: string
          trip_id: string | null
        }
        Insert: {
          booking_id?: string | null
          id?: string
          operator_user_id: string
          result: string
          scan_type: Database["public"]["Enums"]["scan_type"]
          scanned_at?: string
          trip_id?: string | null
        }
        Update: {
          booking_id?: string | null
          id?: string
          operator_user_id?: string
          result?: string
          scan_type?: Database["public"]["Enums"]["scan_type"]
          scanned_at?: string
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
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
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
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
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
          arrival_time: string | null
          available_seats: number | null
          bus_id: string | null
          bus_number: string | null
          bus_type: Database["public"]["Enums"]["bus_type"] | null
          capacity: number | null
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
          operator_code: string | null
          operator_id: string | null
          operator_name: string | null
          origin_city: string | null
          origin_code: string | null
          origin_name: string | null
          origin_terminal_id: string | null
          route_id: string | null
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
      admin_dashboard: { Args: { p_date?: string }; Returns: Json }
      award_loyalty_for_booking: {
        Args: { p_booking_id: string }
        Returns: number
      }
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
      confirm_boarding: { Args: { p_booking_id: string }; Returns: Json }
      confirm_test_payment: {
        Args: { p_ip_address?: string; p_reference: string; p_token: string }
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
      create_test_payment: { Args: { p_booking_id: string }; Returns: Json }
      current_assistant_id: { Args: never; Returns: string }
      current_driver_id: { Args: never; Returns: string }
      current_operator_id: { Args: never; Returns: string }
      current_profile_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      discount_rate_bps: { Args: never; Returns: number }
      end_trip: { Args: { p_trip_id: string }; Returns: Json }
      expire_seat_holds: { Args: never; Returns: Json }
      expire_stale_payments: { Args: never; Returns: Json }
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
      next_booking_reference: { Args: never; Returns: string }
      next_payment_reference: { Args: never; Returns: string }
      next_receipt_number: { Args: never; Returns: string }
      operator_dashboard: { Args: { p_date?: string }; Returns: Json }
      pay_booking_with_wallet: { Args: { p_booking_id: string }; Returns: Json }
      redeem_reward: {
        Args: { p_booking_id: string; p_reward_id: string }
        Returns: Json
      }
      refund_test_payment: { Args: { p_booking_id: string }; Returns: Json }
      release_booking_redemption: {
        Args: { p_booking_id: string }
        Returns: number
      }
      reserve_seats: {
        Args: { p_passengers: Json; p_trip_id: string }
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
      set_payment_url: {
        Args: { p_payment_id: string; p_payment_url: string }
        Returns: undefined
      }
      set_trip_boarding: { Args: { p_trip_id: string }; Returns: Json }
      sos_advance: {
        Args: {
          p_from: Database["public"]["Enums"]["sos_status"][]
          p_note?: string
          p_sos_id: string
          p_to: Database["public"]["Enums"]["sos_status"]
        }
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
      trip_available_seats: { Args: { p_trip_id: string }; Returns: number }
      validate_booking_qr: {
        Args: {
          p_booking_id: string
          p_expected_trip_id?: string
          p_reference: string
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
      assignment_status: "ASSIGNED" | "ACTIVE" | "COMPLETED" | "CANCELLED"
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
      payment_provider: "MOCK" | "STRIPE" | "GCASH" | "MAYA"
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
      scan_type: "VALIDATION" | "BOARDING"
      seat_type: "REGULAR" | "PRIORITY" | "DRIVER" | "RESERVED"
      sos_status:
        | "ACTIVE"
        | "ACKNOWLEDGED"
        | "RESPONDING"
        | "RESOLVED"
        | "CANCELLED"
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
      assignment_status: ["ASSIGNED", "ACTIVE", "COMPLETED", "CANCELLED"],
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
      payment_provider: ["MOCK", "STRIPE", "GCASH", "MAYA"],
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
      scan_type: ["VALIDATION", "BOARDING"],
      seat_type: ["REGULAR", "PRIORITY", "DRIVER", "RESERVED"],
      sos_status: [
        "ACTIVE",
        "ACKNOWLEDGED",
        "RESPONDING",
        "RESOLVED",
        "CANCELLED",
      ],
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

