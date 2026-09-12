import { assessWebCamera, type CameraEnvironment } from '@/lib/web-camera';

const capable: CameraEnvironment = {
  isSecureContext: true,
  hasGetUserMedia: true,
  videoInputCount: 1,
};

describe('assessWebCamera', () => {
  it('allows a secure page with a camera', () => {
    expect(assessWebCamera(capable)).toEqual({ ok: true });
  });

  it('names an insecure page, not a missing API, when both are true', () => {
    // On plain HTTP the browser removes mediaDevices entirely, so both flags
    // are false at once. Reporting "unsupported" would hide the fixable cause.
    expect(
      assessWebCamera({ isSecureContext: false, hasGetUserMedia: false, videoInputCount: null }),
    ).toEqual({ ok: false, reason: 'insecure-context' });
  });

  it('reports a browser without getUserMedia', () => {
    expect(assessWebCamera({ ...capable, hasGetUserMedia: false })).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('reports a machine with no camera', () => {
    expect(assessWebCamera({ ...capable, videoInputCount: 0 })).toEqual({
      ok: false,
      reason: 'no-camera',
    });
  });

  it('does not block when the devices could not be listed', () => {
    // An unreadable list is not evidence of "no camera"; the browser gets to try.
    expect(assessWebCamera({ ...capable, videoInputCount: null })).toEqual({ ok: true });
  });

  it('allows several cameras', () => {
    expect(assessWebCamera({ ...capable, videoInputCount: 3 })).toEqual({ ok: true });
  });
});
