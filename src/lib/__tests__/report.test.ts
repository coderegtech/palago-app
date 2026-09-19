import { ErrorCode } from '@/constants/errors';
import { AppError } from '@/lib/errors';
import { reportFailure, shouldReport } from '@/lib/report';

const mockLogEvent = jest.fn();
const mockReportError = jest.fn();

jest.mock('expo-observe', () => ({
  Observe: {
    logEvent: (...args: unknown[]) => mockLogEvent(...args),
    reportError: (...args: unknown[]) => mockReportError(...args),
  },
}));

describe('reportFailure', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stays silent about refusals the server meant', () => {
    for (const code of [
      ErrorCode.FORBIDDEN,
      ErrorCode.SEAT_UNAVAILABLE,
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.PAYMENT_EXPIRED,
      ErrorCode.UNAUTHORIZED,
    ]) {
      expect(shouldReport(new AppError(code))).toBe(false);
      reportFailure(new AppError(code), 'query:booking');
    }
    expect(mockLogEvent).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('reports an internal error with its request id, and nothing personal', () => {
    const error = new AppError(ErrorCode.INTERNAL_ERROR, 'booking PG-2026-000001 failed', undefined, 'req-123');
    reportFailure(error, 'mutation:unknown');

    expect(mockLogEvent).toHaveBeenCalledWith('app_failure', {
      severity: 'error',
      attributes: { where: 'mutation:unknown', code: 'INTERNAL_ERROR', requestId: 'req-123' },
    });
    // The message (which may name a booking) is not copied into attributes.
    expect(JSON.stringify(mockLogEvent.mock.calls[0])).not.toContain('PG-2026');
    expect(mockReportError).toHaveBeenCalledWith(error);
  });

  it('counts network failures as a warning without a stack report', () => {
    reportFailure(new AppError(ErrorCode.NETWORK_ERROR), 'query:trips');
    expect(mockLogEvent).toHaveBeenCalledWith('app_failure', {
      severity: 'warn',
      attributes: { where: 'query:trips', code: 'NETWORK_ERROR' },
    });
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('reports anything that is not an AppError — nobody planned for it', () => {
    const error = new TypeError('undefined is not a function');
    reportFailure(error, 'query:sos');
    expect(mockLogEvent.mock.calls[0][1].attributes.code).toBe('UNEXPECTED');
    expect(mockReportError).toHaveBeenCalledWith(error);
  });

  it('never throws, even when reporting itself fails', () => {
    mockLogEvent.mockImplementationOnce(() => {
      throw new Error('observe unavailable');
    });
    expect(() => reportFailure(new Error('x'), 'query:x')).not.toThrow();
  });
});
