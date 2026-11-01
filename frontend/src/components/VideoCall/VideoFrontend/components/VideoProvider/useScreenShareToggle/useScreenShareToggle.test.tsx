import { act, renderHook } from '@testing-library/react-hooks';
import { EventEmitter } from 'events';
import { Room } from 'twilio-video';
import useScreenShareToggle from './useScreenShareToggle';

type FakeTrack = { kind: 'video'; label: string; onended: null | (() => void); stop: jest.Mock };

function makeTrack(): FakeTrack {
  return { kind: 'video', label: 'Entire screen', onended: null, stop: jest.fn() };
}

function makeRoom() {
  const localParticipant = Object.assign(new EventEmitter(), {
    publishTrack: jest.fn((track: FakeTrack) => Promise.resolve({ trackSid: 'MT123', track })),
    unpublishTrack: jest.fn(),
  });
  return { localParticipant } as unknown as Room & {
    localParticipant: typeof localParticipant;
  };
}

function mockPicker(impl: () => Promise<unknown>) {
  const getDisplayMedia = jest.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia },
    configurable: true,
  });
  return getDisplayMedia;
}

function streamWith(track: FakeTrack) {
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

function domError(name: string) {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('useScreenShareToggle', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts sharing: opens the picker and publishes a track named "screen"', async () => {
    const track = makeTrack();
    const room = makeRoom();
    const getDisplayMedia = mockPicker(() => Promise.resolve(streamWith(track)));
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, jest.fn()));

    act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toBe(true));

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ name: 'screen' }),
    );
  });

  it('stops sharing from the in-app button: unpublishes, emits trackUnpublished and stops the track', async () => {
    const track = makeTrack();
    const room = makeRoom();
    mockPicker(() => Promise.resolve(streamWith(track)));
    const unpublished = jest.fn();
    room.localParticipant.on('trackUnpublished', unpublished);
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, jest.fn()));

    act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toBe(true));
    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track);
    expect(unpublished).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops sharing when the browser "Stop sharing" control ends the track', async () => {
    const track = makeTrack();
    const room = makeRoom();
    mockPicker(() => Promise.resolve(streamWith(track)));
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, jest.fn()));

    act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toBe(true));
    act(() => track.onended?.());

    expect(result.current[0]).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledTimes(1);
  });

  it('only cleans up once if the browser stop and the button fire together', async () => {
    const track = makeTrack();
    const room = makeRoom();
    mockPicker(() => Promise.resolve(streamWith(track)));
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, jest.fn()));

    act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toBe(true));
    act(() => {
      track.onended?.();
      result.current[2]('button');
    });

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['NotAllowedError', 'AbortError'])(
    'cancelling the picker (%s) does not report an error and allows another attempt',
    async errorName => {
      const room = makeRoom();
      const onError = jest.fn();
      const getDisplayMedia = mockPicker(() => Promise.reject(domError(errorName)));
      const { result } = renderHook(() => useScreenShareToggle(room, onError));

      await act(async () => {
        result.current[1]();
      });
      expect(result.current[0]).toBe(false);
      expect(onError).not.toHaveBeenCalled();
      expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();

      await act(async () => {
        result.current[1]();
      });
      expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    },
  );

  it('reports other picker failures through onError', async () => {
    const room = makeRoom();
    const onError = jest.fn();
    mockPicker(() => Promise.reject(domError('NotReadableError')));
    const { result } = renderHook(() => useScreenShareToggle(room, onError));

    await act(async () => {
      result.current[1]();
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe(false);
  });

  it('does not open a second picker while the first one is still open', async () => {
    const room = makeRoom();
    let resolvePicker: (v: unknown) => void = () => {};
    const getDisplayMedia = mockPicker(() => new Promise(res => (resolvePicker = res)));
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, jest.fn()));

    act(() => result.current[1]());
    act(() => result.current[1]());
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);

    resolvePicker(streamWith(makeTrack()));
    await waitFor(() => expect(result.current[0]).toBe(true));
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('stops the captured track if publishing fails', async () => {
    const track = makeTrack();
    const room = makeRoom();
    const onError = jest.fn();
    room.localParticipant.publishTrack.mockImplementation(() => Promise.reject(new Error('publish failed')));
    mockPicker(() => Promise.resolve(streamWith(track)));
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, onError));

    act(() => result.current[1]());
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe(false);
  });

  it('stopping on disconnect still stops the track when unpublish throws', async () => {
    const track = makeTrack();
    const room = makeRoom();
    room.localParticipant.unpublishTrack.mockImplementation(() => {
      throw new Error('room disconnected');
    });
    mockPicker(() => Promise.resolve(streamWith(track)));
    const { result, waitFor } = renderHook(() => useScreenShareToggle(room, jest.fn()));

    act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toBe(true));
    act(() => result.current[2]('disconnect'));

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe(false);
  });

  it('does nothing without a room', () => {
    const getDisplayMedia = mockPicker(() => Promise.resolve(streamWith(makeTrack())));
    const { result } = renderHook(() => useScreenShareToggle(null, jest.fn()));
    act(() => result.current[1]());
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });
});
