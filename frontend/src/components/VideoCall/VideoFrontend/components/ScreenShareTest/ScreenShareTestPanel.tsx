import React, { useEffect, useState } from 'react';
import {
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TrackPublication,
} from 'twilio-video';
import { usePlayersInVideoCall } from '../../../../../classes/TownController';
import useTownController from '../../../../../hooks/useTownController';
import useScreenShareParticipant from '../../hooks/useScreenShareParticipant/useScreenShareParticipant';
import useTrack from '../../hooks/useTrack/useTrack';
import useVideoContext from '../../hooks/useVideoContext/useVideoContext';
import { IVideoTrack } from '../../types';
import VideoTrack from '../VideoTrack/VideoTrack';
import {
  clearScreenShareLog,
  getScreenShareLog,
  logScreenShareEvent,
  ScreenShareLogEntry,
  subscribeToScreenShareLog,
} from './screenShareTestLog';

/*
 * Screen-share test panel (test build only, enabled with NEXT_PUBLIC_SCREENSHARE_TEST=true).
 *
 * Purpose: let a presenter, a nearby viewer and a player outside the area each record what their
 * client sees. Unlike the normal video grid (which only renders nearby players and never renders
 * screen tracks), this panel renders the screen-share track for EVERY client in the town's Twilio
 * room, and labels whether the sharer is "nearby" according to Covey.Town's proximity rules.
 * That makes it visible whether players outside the area still receive the shared video.
 */

function isScreenPublication(p: TrackPublication) {
  return p.trackName.includes('screen');
}

function subscriptionState(participant: RemoteParticipant, kind: 'screen' | 'audio'): string {
  const pubs = Array.from(participant.tracks.values()).filter(p =>
    kind === 'screen' ? isScreenPublication(p) : p.kind === 'audio',
  );
  if (pubs.length === 0) return 'not published';
  return pubs.every(p => p.isSubscribed) ? 'subscribed' : 'published, NOT subscribed';
}

const cell: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid #ddd' };

export default function ScreenShareTestPanel() {
  const { room, isSharingScreen, toggleScreenShare } = useVideoContext();
  const townController = useTownController();
  const nearbyPlayers = usePlayersInVideoCall();
  const screenShareParticipant = useScreenShareParticipant();
  const [log, setLog] = useState<ScreenShareLogEntry[]>(getScreenShareLog());
  const [collapsed, setCollapsed] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => subscribeToScreenShareLog(setLog), []);

  // Log the room events that matter for the test and re-render the status table when they happen.
  useEffect(() => {
    if (!room) return;
    const refresh = () => setTick(t => t + 1);
    const nameOf = (p: Participant) =>
      townController.players.find(player => player.id === p.identity)?.userName ?? p.identity;

    const onSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      logScreenShareEvent(`Subscribed to ${nameOf(p)}'s ${pub.trackName || track.kind} track`);
      refresh();
    };
    const onUnsubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      logScreenShareEvent(`Unsubscribed from ${nameOf(p)}'s ${pub.trackName || track.kind} track`);
      refresh();
    };
    const onPublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (isScreenPublication(pub)) logScreenShareEvent(`${nameOf(p)} published a screen track`);
      refresh();
    };
    const onUnpublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (isScreenPublication(pub)) logScreenShareEvent(`${nameOf(p)} unpublished their screen track`);
      refresh();
    };
    const onConnected = (p: RemoteParticipant) => {
      logScreenShareEvent(`${nameOf(p)} joined the video room`);
      refresh();
    };
    const onDisconnected = (p: RemoteParticipant) => {
      logScreenShareEvent(`${nameOf(p)} left the video room (disconnect)`);
      refresh();
    };
    const onRoomState = (state: string) => () => {
      logScreenShareEvent(`Local room state: ${state}`);
      refresh();
    };
    const onReconnecting = onRoomState('reconnecting');
    const onReconnected = onRoomState('reconnected');
    const onRoomDisconnected = onRoomState('disconnected');

    room.on('trackSubscribed', onSubscribed);
    room.on('trackUnsubscribed', onUnsubscribed);
    room.on('trackPublished', onPublished);
    room.on('trackUnpublished', onUnpublished);
    room.on('participantConnected', onConnected);
    room.on('participantDisconnected', onDisconnected);
    room.on('reconnecting', onReconnecting);
    room.on('reconnected', onReconnected);
    room.on('disconnected', onRoomDisconnected);
    logScreenShareEvent(`Test panel attached to video room ${room.name} as ${room.localParticipant.identity}`);
    return () => {
      room.off('trackSubscribed', onSubscribed);
      room.off('trackUnsubscribed', onUnsubscribed);
      room.off('trackPublished', onPublished);
      room.off('trackUnpublished', onUnpublished);
      room.off('participantConnected', onConnected);
      room.off('participantDisconnected', onDisconnected);
      room.off('reconnecting', onReconnecting);
      room.off('reconnected', onReconnected);
      room.off('disconnected', onRoomDisconnected);
    };
  }, [room, townController]);

  const localIdentity = room?.localParticipant.identity;
  const sharerIsLocal = !!screenShareParticipant && screenShareParticipant.identity === localIdentity;
  const sharerIsNearby =
    !!screenShareParticipant && nearbyPlayers.some(p => p.id === screenShareParticipant.identity);
  const nameOfId = (id: string) =>
    id === localIdentity
      ? `${townController.ourPlayer.userName} (you)`
      : townController.players.find(p => p.id === id)?.userName ?? id;

  // Log when the sharer moves into / out of proximity, since that decides whether the normal UI would show them.
  const sharerId = screenShareParticipant?.identity;
  useEffect(() => {
    if (sharerId && !sharerIsLocal) {
      logScreenShareEvent(`Sharer ${sharerId} is ${sharerIsNearby ? 'NEARBY' : 'NOT nearby'} this player`);
    }
  }, [sharerId, sharerIsLocal, sharerIsNearby]);

  const screenPublication = screenShareParticipant
    ? (Array.from(screenShareParticipant.tracks.values()).find(isScreenPublication) as
        | LocalTrackPublication
        | RemoteTrackPublication
        | undefined)
    : undefined;
  const screenTrack = useTrack(screenPublication);

  const remoteParticipants = room ? Array.from(room.participants.values()) : [];

  const copyLog = () => {
    const text = getScreenShareLog()
      .map(e => `${e.time} ${e.message}`)
      .join('\n');
    navigator.clipboard?.writeText(`Client: ${nameOfId(localIdentity ?? '')}\n${text}`).catch(() => {
      // Clipboard can be blocked (e.g. non-https); the log is also in the console.
    });
  };

  return (
    <div
      data-testid='screen-share-test-panel'
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        width: 360,
        maxHeight: '90vh',
        overflowY: 'auto',
        zIndex: 2000,
        background: 'white',
        color: 'black',
        border: '2px solid #444',
        borderRadius: 6,
        padding: 8,
        fontSize: 12,
        fontFamily: 'monospace',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Screen share test</strong>
        <button onClick={() => setCollapsed(c => !c)}>{collapsed ? 'Expand' : 'Collapse'}</button>
      </div>
      {!collapsed && (
        <>
          <div>Client: {localIdentity ? nameOfId(localIdentity) : 'not connected'}</div>
          <div>Room state: {room ? room.state : 'no room'}</div>
          <div style={{ margin: '6px 0' }}>
            <button
              data-testid='screen-share-test-toggle'
              disabled={!room || (!!screenShareParticipant && !sharerIsLocal)}
              onClick={toggleScreenShare}>
              {isSharingScreen ? 'Stop sharing' : 'Share screen'}
            </button>
          </div>
          <div>
            Sharer:{' '}
            {screenShareParticipant
              ? `${nameOfId(screenShareParticipant.identity)}${
                  sharerIsLocal ? '' : sharerIsNearby ? ' [nearby]' : ' [NOT nearby]'
                }`
              : 'nobody'}
          </div>
          <div>
            Screen track on this client:{' '}
            {!screenPublication
              ? 'none'
              : screenTrack
              ? sharerIsLocal
                ? 'local preview'
                : 'RECEIVED (subscribed)'
              : 'published but NOT received'}
          </div>
          {screenTrack && screenTrack.kind === 'video' && (
            <div style={{ height: 180, background: '#000', marginTop: 4 }}>
              <VideoTrack track={screenTrack as IVideoTrack} />
            </div>
          )}
          <table style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={cell}>Player</th>
                <th style={cell}>Nearby</th>
                <th style={cell}>Screen</th>
                <th style={cell}>Audio</th>
              </tr>
            </thead>
            <tbody>
              {remoteParticipants.length === 0 && (
                <tr>
                  <td style={cell} colSpan={4}>
                    No other participants in the video room
                  </td>
                </tr>
              )}
              {remoteParticipants.map(p => (
                <tr key={p.sid}>
                  <td style={cell}>{nameOfId(p.identity)}</td>
                  <td style={cell}>{nearbyPlayers.some(n => n.id === p.identity) ? 'yes' : 'no'}</td>
                  <td style={cell}>{subscriptionState(p, 'screen')}</td>
                  <td style={cell}>{subscriptionState(p, 'audio')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button onClick={copyLog}>Copy log</button>
            <button onClick={clearScreenShareLog}>Clear log</button>
          </div>
          <div
            style={{
              marginTop: 4,
              maxHeight: 200,
              overflowY: 'auto',
              background: '#f4f4f4',
              padding: 4,
              whiteSpace: 'pre-wrap',
            }}>
            {log.length === 0
              ? 'No events yet'
              : log
                  .slice()
                  .reverse()
                  .map((e, i) => <div key={log.length - i}>{`${e.time} ${e.message}`}</div>)}
          </div>
        </>
      )}
    </div>
  );
}
