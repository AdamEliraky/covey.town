import { useState, useCallback, useRef } from 'react';
import { LogLevels, Track, Room } from 'twilio-video';
import { ErrorCallback } from '../../../types';
import { logScreenShareEvent } from '../../ScreenShareTest/screenShareTestLog';

interface MediaStreamTrackPublishOptions {
  name?: string;
  priority: Track.Priority;
  logLevel: LogLevels;
}

export type ScreenShareStopReason = 'button' | 'browser' | 'disconnect';

export default function useScreenShareToggle(room: Room | null, onError: ErrorCallback) {
  const [isSharing, setIsSharing] = useState(false);
  const stopScreenShareRef = useRef<((reason: ScreenShareStopReason) => void) | null>(null);
  // True while the browser's screen picker is open or the track is being published.
  // Prevents a second click from opening a second picker / publishing a second track.
  const isStartingRef = useRef(false);

  const shareScreen = useCallback(() => {
    if (!room || isStartingRef.current) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      logScreenShareEvent('getDisplayMedia is not supported in this browser');
      return;
    }
    isStartingRef.current = true;
    logScreenShareEvent('Opening screen picker');

    navigator.mediaDevices
      .getDisplayMedia({
        audio: false,
        video: {
          frameRate: 10,
          height: 1080,
          width: 1920,
        },
      })
      .then(stream => {
        const track = stream.getVideoTracks()[0];
        if (!track) {
          isStartingRef.current = false;
          logScreenShareEvent('Picker returned a stream with no video track');
          return;
        }
        logScreenShareEvent(
          `Picker accepted (${track.label || 'unknown source'}), publishing track`,
        );

        // All video tracks are published with 'low' priority. This works because the video
        // track that is displayed in the 'MainParticipant' component will have it's priority
        // set to 'high' via track.setPriority()
        room.localParticipant
          .publishTrack(track, {
            name: 'screen', // Tracks can be named to easily find them later
            priority: 'low', // Priority is set to high by the subscriber when the video track is rendered
          } as MediaStreamTrackPublishOptions)
          .then(trackPublication => {
            let stopped = false;
            stopScreenShareRef.current = (reason: ScreenShareStopReason) => {
              // The browser's "Stop sharing" bar, the in-app button and a room disconnect
              // can all fire close together, so only clean up once.
              if (stopped) return;
              stopped = true;
              try {
                room.localParticipant.unpublishTrack(track);
                // TODO: remove this if the SDK is updated to emit this event
                room.localParticipant.emit('trackUnpublished', trackPublication);
              } catch (e) {
                // Unpublishing from a room that has already disconnected can throw; the track
                // still needs to be stopped below so the browser's sharing indicator goes away.
                logScreenShareEvent(
                  `Unpublish failed (${(e as Error).message}); stopping track anyway`,
                );
              }
              track.stop();
              stopScreenShareRef.current = null;
              setIsSharing(false);
              logScreenShareEvent(`Screen share stopped (reason: ${reason})`);
            };

            track.onended = () => stopScreenShareRef.current?.('browser');
            isStartingRef.current = false;
            setIsSharing(true);
            logScreenShareEvent(`Screen share published (track sid ${trackPublication.trackSid})`);
          })
          .catch(error => {
            isStartingRef.current = false;
            track.stop();
            logScreenShareEvent(`Publishing screen track failed: ${error.name}: ${error.message}`);
            onError(error);
          });
      })
      .catch(error => {
        isStartingRef.current = false;
        // Don't display an error if the user closes the screen share dialog
        if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
          logScreenShareEvent(`Screen picker failed: ${error.name}: ${error.message}`);
          onError(error);
        } else {
          logScreenShareEvent(`Screen picker cancelled (${error.name})`);
        }
      });
  }, [room, onError]);

  const stopScreenShare = useCallback((reason: ScreenShareStopReason) => {
    stopScreenShareRef.current?.(reason);
  }, []);

  const toggleScreenShare = useCallback(() => {
    if (room) {
      !isSharing ? shareScreen() : stopScreenShare('button');
    }
  }, [isSharing, shareScreen, stopScreenShare, room]);

  return [isSharing, toggleScreenShare, stopScreenShare] as const;
}
