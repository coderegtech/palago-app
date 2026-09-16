/**
 * Turning a schedule clash into something an operator can act on.
 *
 * The database refuses an overlap with an exclusion constraint, and
 * `create_trip` catches that and re-raises `SCHEDULE_CONFLICT` with the
 * clashing departure in the statement's DETAIL. PostgREST hands DETAIL back as
 * `error.details`, so this thin layer is the whole difference between "that
 * clashes with CHERRY-0919-B, which has the same bus or crew at that time" and
 * "that bus is busy" — which tells an operator nothing about which of their own
 * departures to move.
 *
 * It is worth testing because it is string handling on an error path. Error
 * paths are the code least likely to be exercised by hand, and a clash is the
 * single most likely thing to go wrong when somebody is building next week's
 * timetable. If the shape of `details` ever changes, the failure is silent: the
 * conflict is still refused, the message just stops naming anything.
 */

import { ErrorCode } from '@/constants/errors';
import { AppError } from '@/lib/errors';
import { scheduleService, ScheduleConflictError } from '@/services/schedule-service';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;

const TRIP = {
  routeId: 'route-1',
  busId: 'bus-1',
  tripNumber: 'CHERRY-0920-A',
  departureDate: '2026-09-20',
  departureTime: '06:00',
  arrivalTime: '12:00',
  fare: 85000,
};

beforeEach(() => jest.clearAllMocks());

describe('a schedule clash', () => {
  it('names the departure in the way', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: ErrorCode.SCHEDULE_CONFLICT, details: 'CHERRY-0919-B' },
    });

    await expect(scheduleService.createTrip(TRIP)).rejects.toMatchObject({
      name: 'ScheduleConflictError',
      code: ErrorCode.SCHEDULE_CONFLICT,
      clashesWith: 'CHERRY-0919-B',
    });

    const error = await scheduleService.createTrip(TRIP).catch((e) => e);
    expect(error.message).toContain('CHERRY-0919-B');
  });

  it('survives a clash with nothing named', async () => {
    // Still a refusal, still the right code — just without the detail. The
    // constructor must not interpolate `null` into the sentence.
    rpc.mockResolvedValue({ data: null, error: { message: ErrorCode.SCHEDULE_CONFLICT } });

    const error = await scheduleService.createTrip(TRIP).catch((e) => e);
    expect(error).toBeInstanceOf(ScheduleConflictError);
    expect(error.clashesWith).toBeNull();
    expect(error.message).not.toContain('null');
    expect(error.message).not.toContain('undefined');
  });

  it.each([
    ['whitespace only', '   ', null],
    ['padded', '  CHERRY-0919-B  ', 'CHERRY-0919-B'],
    ['empty', '', null],
  ])('treats a %s detail sensibly', async (_label, details, expected) => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: ErrorCode.SCHEDULE_CONFLICT, details },
    });

    const error = await scheduleService.createTrip(TRIP).catch((e) => e);
    expect(error.clashesWith).toBe(expected);
  });

  it('is still an AppError, so existing error handling keeps working', async () => {
    // Screens catch AppError. A conflict that did not extend it would fall
    // through to the generic "something went wrong" handler and lose the
    // message this class exists to produce.
    rpc.mockResolvedValue({
      data: null,
      error: { message: ErrorCode.SCHEDULE_CONFLICT, details: 'RORO-0921-C' },
    });

    const error = await scheduleService.createTrip(TRIP).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
  });
});

describe('every other failure', () => {
  it('is not dressed up as a clash', async () => {
    // The check is `message === 'SCHEDULE_CONFLICT'` exactly. Anything else —
    // a forbidden caller, an inactive bus — has to keep its own code, or an
    // operator is told to move a trip that is not the problem.
    rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', details: 'nope' } });

    const error = await scheduleService.createTrip(TRIP).catch((e) => e);
    expect(error).not.toBeInstanceOf(ScheduleConflictError);
    expect(error.code).not.toBe(ErrorCode.SCHEDULE_CONFLICT);
  });

  it('does not match on a message that merely contains the code', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'not a SCHEDULE_CONFLICT at all', details: 'X' },
    });

    const error = await scheduleService.createTrip(TRIP).catch((e) => e);
    expect(error).not.toBeInstanceOf(ScheduleConflictError);
  });
});

describe('createTrip', () => {
  it('trims the trip number before sending it', async () => {
    rpc.mockResolvedValue({ data: { id: 't1', tripNumber: 'CHERRY-0920-A' }, error: null });

    await scheduleService.createTrip({ ...TRIP, tripNumber: '  CHERRY-0920-A  ' });

    expect(rpc).toHaveBeenCalledWith(
      'create_trip',
      expect.objectContaining({ p_trip_number: 'CHERRY-0920-A' }),
    );
  });

  it('omits the operator so the server infers it', async () => {
    // An operator scheduling for themselves must not be able to name somebody
    // else's operator id. Sending `undefined` lets the function's own default
    // resolve it from the caller's profile.
    rpc.mockResolvedValue({ data: { id: 't1', tripNumber: 'x' }, error: null });

    await scheduleService.createTrip(TRIP);

    expect(rpc.mock.calls[0][1].p_operator_id).toBeUndefined();
  });

  it('passes an explicit operator through for an admin', async () => {
    rpc.mockResolvedValue({ data: { id: 't1', tripNumber: 'x' }, error: null });

    await scheduleService.createTrip({ ...TRIP, operatorId: 'operator-9' });

    expect(rpc.mock.calls[0][1].p_operator_id).toBe('operator-9');
  });
});
