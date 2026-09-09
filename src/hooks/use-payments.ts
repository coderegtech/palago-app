/**
 * Payment queries, mutations, and the Realtime subscription that lets the app
 * notice a confirmation that happened on someone else's screen.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { PaymentStatus } from '@/constants/enums';
import { bookingKeys } from '@/hooks/use-trips';
import { supabase } from '@/lib/supabase';
import { paymentService, type CreatedPayment } from '@/services/payment-service';
import type { UUID } from '@/types/models';

export const paymentKeys = {
  forBooking: (bookingId: UUID) => ['payments', 'booking', bookingId] as const,
  receipt: (bookingId: UUID) => ['receipts', bookingId] as const,
  public: (reference: string) => ['payments', 'public', reference] as const,
};

export function usePaymentForBooking(bookingId: UUID | null) {
  return useQuery({
    queryKey: paymentKeys.forBooking(bookingId ?? 'none'),
    queryFn: () => paymentService.getPaymentForBooking(bookingId!),
    enabled: bookingId !== null,
  });
}

export function useReceipt(bookingId: UUID | null) {
  return useQuery({
    queryKey: paymentKeys.receipt(bookingId ?? 'none'),
    queryFn: () => paymentService.getReceipt(bookingId!),
    enabled: bookingId !== null,
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation<CreatedPayment, Error, UUID>({
    mutationFn: (bookingId) => paymentService.createPayment(bookingId),
    onSuccess: (_data, bookingId) => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.forBooking(bookingId) });
      queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
    },
  });
}

/** The public page's read. Not cached long — the status is the whole point. */
export function usePublicPayment(reference: string | null, token: string | null) {
  return useQuery({
    queryKey: paymentKeys.public(reference ?? 'none'),
    queryFn: () => paymentService.getPublicPayment(reference!, token!),
    enabled: Boolean(reference && token),
    staleTime: 0,
    retry: 1,
  });
}

export function useConfirmPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reference, token }: { reference: string; token: string }) =>
      paymentService.confirmPayment(reference, token),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.public(variables.reference) });
    },
  });
}

/**
 * Watches one payment for a status change.
 *
 * This exists because the confirmation happens somewhere else: the passenger
 * scans the QR with a browser — often on a second phone — and this app is left
 * holding a booking it cannot see the outcome of. Polling would either be slow
 * or wasteful, so the database pushes instead.
 *
 * Realtime respects RLS, so this only ever delivers rows the signed-in user
 * could already read.
 *
 * Returns the latest status seen, or null until something arrives.
 */
export function usePaymentStatusSubscription(paymentId: UUID | null, bookingId: UUID | null) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PaymentStatus | null>(null);

  useEffect(() => {
    if (!paymentId) return;

    const channel = supabase
      .channel(`payment:${paymentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'payments',
          filter: `id=eq.${paymentId}`,
        },
        (payload) => {
          const next = (payload.new as { status?: PaymentStatus }).status ?? null;
          setStatus(next);

          // Refetch rather than trusting the pushed row: the payload is one
          // table, and confirmation also moved the booking and the seats.
          queryClient.invalidateQueries({ queryKey: paymentKeys.forBooking(bookingId ?? 'none') });
          if (bookingId) {
            queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
            queryClient.invalidateQueries({ queryKey: bookingKeys.full(bookingId) });
            queryClient.invalidateQueries({ queryKey: paymentKeys.receipt(bookingId) });
          }
          queryClient.invalidateQueries({ queryKey: bookingKeys.list });
        },
      )
      .subscribe();

    return () => {
      // Left behind, these accumulate and the app slows the longer it is used.
      supabase.removeChannel(channel);
    };
  }, [paymentId, bookingId, queryClient]);

  return status;
}
