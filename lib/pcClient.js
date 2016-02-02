/*jslint browser: true*/
/*global RTCPeerConnection, RTCSessionDescription, RTCIceCandidate*/
var events2 = require('eventemitter2');
var util = require('util');
var MSG = require('./api');
var debug = require('debug')('yodlr:audiorouterclient:PCClient');
var dMetrics = require('debug')('yodlr:audiorouterclient:metrics');

var timeoutInterval = 5000;
var failureInterval = 10000;

try {
  if(WebSocket) {
    var adapter = require('webrtc-adapter-test');
  }
} catch(e) {
  if(!(e instanceof ReferenceError)) {
    debug('Error detecting WebSocket' + e);
  }
}

var PCClient = module.exports = function PCClient(options) {
  events2.EventEmitter2.call(this);
  var client = this;

  if(!options) {
    throw new Error('Cannot create PCClient. '
      + 'No options provided');
  }
  if(!options.account) {
    throw new Error('Cannot create PCClient. '
    + 'No account provided');
  }
  if(!options.room) {
    throw new Error('Cannot create PCClient. '
    + 'No room provided');
  }
  if(!options.participant) {
    throw new Error('Cannot create PCClient. '
    + 'No participant provided');
  }
  if(!options.sock) {
    throw new Error('Cannot create PCClient. '
    + 'No socket.io sock provided');
  }

  client._account = options.account;
  client._room = options.room;
  client._participant = options.participant;
  client._sock = options.sock;
  client._pcConfig = options.ice;

  client._sock.on('signal', client._onSockMessage.bind(client));

  setTimeout(function emitTimeout() {
    client.emit(MSG.ready);
  }, 0);

  debug('Creating PCClient instance',
    'Participant:', options.participant,
    'Account: ', options.account,
    'Room:', options.room);
};
util.inherits(PCClient, events2.EventEmitter2);

PCClient.prototype.send = function send(audio) {
};

PCClient.prototype.close = function close() {
};

PCClient.prototype.setStream = function setStream(stream) {
  var client = this;

  if(client.pc && client._stream) {
    client.pc.removeStream(client._stream);
    client.pc.addStream(stream);
    client._stream = stream;
    client.pc.createOffer(client._onCreateOffer.bind(client),
                          client._onCreateOfferError.bind(client));
    debug('ReSetting stream');
  }
  else {
    client._stream = stream;
    client.createPeerConnection();
    debug('Setting stream');
    client._setStreamTimeout = setTimeout(function setStreamTimeout() {
      client._timeout(new Error('setStream timed out'));
    }, timeoutInterval);

    client._setStreamFailure = setTimeout(function setStreamFailure() {
      clearTimeout(client._setStreamTimeout);
      client._failure(new Error('setStream failed'));
    }, failureInterval);
  }
};

PCClient.prototype.createPeerConnection = function createPeerConnection() {
  var client = this;

  debug('Creating PeerConnection');
  try {
    client.pc = new RTCPeerConnection(client._pcConfig);
    client.pc.onicecandidate = client._onIceCandidate.bind(client);
    client.pc.onaddstream = client._onAddStream.bind(client);
    client.pc.onremovestream = client._onRemoveStream.bind(client);
    client.pc.oniceconnectionstatechange =
      client._onIceConnectionStateChange.bind(client);
    client.pc.onsignalingstatechange =
      client._onSignalingStateChange.bind(client);
    client.pc.addStream(client._stream);
    client.pc.createOffer(client._onCreateOffer.bind(client),
                          client._onCreateOfferError.bind(client));
    debug('Created PeerConnection');
  }
  catch(e) {
    debug('Failed to create PeerConnection', e.message);
  }
};

PCClient.prototype._onSockMessage = function _onSockMessage(message) {
  var client = this;
  // if(message.type === 'offer') {
  //   client.pc.setRemoteDescription(new RTCSessionDescription(message));
  //   client._createAnswer();
  // }
  if(message.type === 'answer') {
    client.pc.setRemoteDescription(new RTCSessionDescription(message));
    debug('Answer received');
  }
  else if(message.type === 'candidate') {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    client.pc.addIceCandidate(candidate);
    debug('Candidate received', message.candidate);
  }
};

PCClient.prototype._onIceCandidate = function _onIceCandidate(event) {
  var client = this;
  if(event.candidate) {
    var msg = {
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    };
    debug('_onIceCandidate: candiate', event.candidate.candidate);
    client._sock.emit('signal', msg);
  }
  else {
    debug('End of candidates', event);
  }
};

PCClient.prototype._onIceConnectionStateChange =
  function _onIceConnectionStateChange(event) {
  var client = this;
  debug('onIceConnectionStateChange', {
    iceState: client.pc.iceConnectionState,
    signalState: client.pc.signalingState,
    event: event
  });
  client.emit('onIceConnectionStateChange', {
    iceState: client.pc.iceConnectionState,
    signalState: client.pc.signalingState,
    event: event
  });

  if(event.currentTarget.iceConnectionState === 'connected') {
    clearTimeout(client._setStreamTimeout);
    clearTimeout(client._setStreamFailure);
    client.emit(MSG.connected);
  }

  if(event.currentTarget.iceConnectionState === 'failed') {
    client.emit(MSG.connectionFailure);
  }

  if(event.currentTarget.iceConnectionState === 'disconnected') {
    client.emit(MSG.disconnected);
  }
};

PCClient.prototype._onSignalingStateChange =
  function _onSignalingStateChange(event) {
  var client = this;
  debug('onSignalingStateChange', {
    iceState: client.pc.iceConnectionState,
    signalState: client.pc.signalingState,
    event: event
  });
  client.emit('onSignalingStateChange', {
    iceState: client.pc.iceConnectionState,
    signalState: client.pc.signalingState,
    event: event
  });
};

PCClient.prototype._onAddStream = function _onAddStream(event) {
  var client = this;
  var stream = event.stream;
  var audioElement = document.createElement('audio');
  adapter.attachMediaStream(audioElement, stream);
  document.querySelector('body').appendChild(audioElement);
  audioElement.play();
  debug('_onAddStream: added mediaStream', stream);
  client._startMetrics();
};

PCClient.prototype._onRemoveStream = function _onRemoveStream(event) {
  debug('_onRemoveStream', event);
};

PCClient.prototype._onCreateOffer = function _onCreateOffer(offer) {
  var client = this;

  offer.sdp = client._setSessionDescription(offer.sdp);
  client.pc.setLocalDescription(offer);
  client._sock.emit('signal', offer);
  debug('_onCreateOffer');
};

PCClient.prototype._onCreateOfferError = function _onCreateOfferError(event) {
  debug('_onCreateOfferError', event);
};

PCClient.prototype._createAnswer = function _createAnswer() {
  var client = this;
  var sdpConstraints = {
    mandatory: {
      OfferToReceiveAudio: true,
      OfferToReceiveVideo: false
    }
  };

  client.pc.createAnswer(client._onCreateOffer.bind(client),
                        null, sdpConstraints);
  debug('_createAnswer');
};

PCClient.prototype._setSessionDescription =
  function _setSessionDescription(sdp) {
  var spdArray = sdp.split('\r\n');
  var mAudioIndex;
  var opus;
  var cnArray = [];
  var cnSpdArray = [];

  for(var l = 0; l < spdArray.length; l++) {
    if(spdArray[l].indexOf('m=audio') !== -1) {
      mAudioIndex = l;
      break;
    }
  }

  if(mAudioIndex === null) {
    return sdp;
  }

  // If Opus is available, set it as the default in m line.
  for(var i = 0; i < spdArray.length; i++) {
    if(spdArray[i].indexOf('opus/48000') !== -1) {
      var opusMatch = spdArray[i].match(/:(\d+) opus\/48000/i);
      opus = opusMatch && opusMatch.length === 2 ? opusMatch[1] : null;
    }
    if(spdArray[i].indexOf('CN/') !== -1) {
      var cnMatch = spdArray[i].match(/a=rtpmap:(\d+) CN\/\d+/i);
      var cn = cnMatch && cnMatch.length === 2 ? cnMatch[1] : null;
      if(cn) {
        cnArray.push(cn);
        cnSpdArray.push(i);
      }
    }
  }

  if(opus) {
    var mAudioElements = spdArray[mAudioIndex].split(' ');
    var newMAudioArray = [];
    var index = 0;
    for(var j = 0; j < mAudioElements.length; j++) {
      if(j === 3) {
        newMAudioArray[index++] = opus;
      }
      if(mAudioElements[j] !== opus
        && cnArray.indexOf(mAudioElements[j]) === -1) {
        newMAudioArray[index++] = mAudioElements[j];
      }
    }
    spdArray[mAudioIndex] = newMAudioArray.join(' ');
  }

  var cnLength = cnSpdArray.length;
  for(var k = 0; k < cnLength; k++) {
    spdArray.splice(cnSpdArray.pop(), 1);
  }

  sdp = spdArray.join('\r\n');
  return sdp;
};

PCClient.prototype._startMetrics = function _startMetrics() {
  var client = this;
  client._debug = true;

  if (adapter.webrtcDetectedBrowser === 'chrome') {
    client._metricsInterval = setInterval(function metricInterval() {
      client.pc.getStats(client._onStats, client._getStatsError);
    }, 5000);
  }
};

PCClient.prototype._onStats = function _onStats(report) {
  var reportResults = report.result();
  var stats = {};
  for(var i = 0; i < reportResults.length; i++) {
    if(reportResults[i].id.indexOf('send') >= 0) {
      stats.packetsLostTX = reportResults[i].stat('packetsLost');
      stats.packetsSent = reportResults[i].stat('packetsSent');
      stats.bytesSent = reportResults[i].stat('bytesSent');
      stats.googRtt = reportResults[i].stat('googRtt');
      stats.audioInputLevel = reportResults[i].stat('audioInputLevel');
    }
    if(reportResults[i].id.indexOf('recv') >= 0) {
      stats.packetsLostRX = reportResults[i].stat('packetsLost');
      stats.packetsReceived = reportResults[i].stat('packetsReceived');
      stats.bytesReceived = reportResults[i].stat('bytesReceived');
      stats.audioOutputLevel = reportResults[i].stat('audioOutputLevel');
    }
  }

  dMetrics('PeerConnection Metrics',
    'Packets Lost TX', stats.packetsLostTX,
    'Packets Lost RX', stats.packetsLostRX,
    'Packets TX', stats.packetsSent,
    'Packets RX', stats.packetsReceived,
    'Bytes TX', stats.bytesSent,
    'Bytes RX', stats.bytesReceived,
    'RTT', stats.googRtt,
    'Audio Input', stats.audioInputLevel,
    'Audio Output', stats.audioOutputLevel);
  stats = {};
};

PCClient.prototype._stopMetrics = function _stopMetrics() {
  var client = this;
  if (client._metricsInterval) {
    clearTimeout(client._metricsInterval);
    client._metricsInterval = null;
  }
};

PCClient.prototype._getStatsError = function _getStatsError(err) {
  debug('Error getting stats', err);
};

PCClient.prototype._timeout = function _timeout(err) {
  var client = this;
  debug('connection timed out', err);
  client.emit(MSG.connectionTimeout, err);
};

PCClient.prototype._failure = function _failure(err) {
  var client = this;
  debug('connection failed', err);
  client.emit(MSG.connectionFailure, err);
};
