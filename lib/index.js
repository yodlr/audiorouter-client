var events2 = require('eventemitter2');
var util = require('util');
var io = require('socket.io-client');
var MSG = require('./api');
var debug = require('debug')('yodlr:audiorouterclient');
var latencyDebug = require('debug')('yodlr:audiorouterclient:latency');
var dMetrics = require('debug')('yodlr:audiorouterclient:metrics');
var WSClient = require('./wsClient');
var PCClient = require('./pcClient');

var BROWSER = false;

var timeoutInterval = 5000; //time before a timeout is emited and a connection is retried
var failureInterval = 10000; //how long to wait before a timeout is considered a failure (and retries stop)

try {
  if(WebSocket) {
    BROWSER = true;
  }
} catch(e) {
  if(!(e instanceof ReferenceError)) {
    debug('Error detecting WebSocket' + e);
  }
}

var AudioRouterClient = module.exports = function AudioRouterClient(options) {
  events2.EventEmitter2.call(this);
  var client = this;
  if(!options) {
    throw new Error('Cannot create AudioRouterClient. '
      + 'No options provided');
  }
  if(!options.wsUrlBinary) {
    throw new Error('Cannot create AudioRouterClient. '
      + 'No web socket URL provided');
  }
  if(!options.account) {
    throw new Error('Cannot create AudioRouterClient. '
    + 'No account provided');
  }
  if(!options.room) {
    throw new Error('Cannot create AudioRouterClient. '
    + 'No room provided');
  }
  if(!options.participant) {
    throw new Error('Cannot create AudioRouterClient. '
    + 'No participant provided');
  }
  if(!options.rate) {
    throw new Error('Cannot create AudioRouterClient. '
    + 'No rate provided');
  }
  debug('Creating AudioRouterClient instance',
    'Url:', options.wsUrlBinary,
    'Participant:', options.participant,
    'Account: ', options.account,
    'Room:', options.room);

  client._wsUrlBinary = options.wsUrlBinary;
  client._account = options.account;
  client._room = options.room;
  client._participant = options.participant;
  client._protocol = options.protocol || 'peer';
  client._udp = false;
  if (options.hasOwnProperty('udp')) {
    client._udp = options.udp;
  }
  client._rate = options.rate;
  client._metrics = {};
  client._metrics.PACKETS = 0;
  client._metrics.SAMPLES = 0;
  client._metrics.PACKETS_RX = 0;
  client._metrics.SAMPLES_RX = 0;
  if(options.debug) {
    client._debug = options.debug;
    client.metrics();
  }

  client.connect();
};
util.inherits(AudioRouterClient, events2.EventEmitter2);

AudioRouterClient.prototype.connect = function connect() {
  var client = this;
  if (client._sock) {
    debug('Connect already called');
    return;
  }
  debug('Connecting to server ' + client._wsUrlBinary);
  client._startMetrics();

  client._sock = io(client._wsUrlBinary, {
    'force new connection': true,
    'transports': ['websocket']
  });

  client._clientConnectionTimeout = setTimeout(function reattemptSetup() {
    client._timeout(new Error('Did not receive setup response'));
  }, timeoutInterval);

  client._clientConnectionFailure = setTimeout(function setupFailure() {
    clearTimeout(client._clientConnectionTimeout);
    client._failure(new Error('Did not receive setup response'));
  }, failureInterval);

  client._setupEventHandlers();
};

AudioRouterClient.prototype.close = function close() {
  var client = this;
  debug('Closing connection');
  client._stopMetrics();
  client._sock.close();
  if (client._net) {
    client._net.close();
  }
  client.emit('closed');
};

AudioRouterClient.prototype.terminate = function terminate() {
  var client = this;
  debug('Terminating');
  client._sock.close();
  if (client._net) {
    client._net.close();
  }
  client.emit('closed');
};

AudioRouterClient.prototype._startMetrics = function _startMetrics() {
  var client = this;
  client._debug = true;

  client._metricsInterval = setInterval(function metricInterval() {
    dMetrics('Audio Metrics',
      'Packets TX:', client._metrics.PACKETS,
      'TX Samples:', client._metrics.SAMPLES,
      'Packets RX', client._metrics.PACKETS_RX,
      'RX Samples:', client._metrics.SAMPLES_RX);
    client._metrics.PACKETS = 0;
    client._metrics.SAMPLES = 0;
    client._metrics.PACKETS_RX = 0;
    client._metrics.SAMPLES_RX = 0;

  }, 5000);
};

AudioRouterClient.prototype._stopMetrics = function _stopMetrics() {
  var client = this;
  if (client._metricsInterval) {
    clearTimeout(client._metricsInterval);
    client._metricsInterval = null;
  }
};

AudioRouterClient.prototype.sendAudio = function sendAudio(audioBuffer) {
  var client = this;

  var packet = client.createPacket(audioBuffer);
  if(client._debug) {
    client._metrics.PACKETS += 1;
    client._metrics.SAMPLES += audioBuffer.length;
  }
  if (client._net) {
    client._net.send(packet);
  }
};

AudioRouterClient.prototype.createPacket = function createPacket(audioBuffer) {
  var client = this;

  var audioHeader = client.serializeAudioHeader(audioBuffer.length);
  audioHeader += '\n';

  var packet = new ArrayBuffer(audioHeader.length + audioBuffer.byteLength);

  var packetHeader = new DataView(packet, 0, audioHeader.length);
  for(var i = 0; i < audioHeader.length; i++) {
    packetHeader.setInt8(i, audioHeader[i].charCodeAt(), true);
  }

  var packetAudio = new DataView(packet, audioHeader.length,
    audioBuffer.byteLength);
  for(var j = 0; j < audioBuffer.length; j++) {
    packetAudio.setInt16(j * 2, audioBuffer[j], true);
  }
  return packet;
};

AudioRouterClient.prototype.splitAudioPacket =
    function splitAudioPacket(buffer) {
  var packetOffset;

  var aBuff = new ArrayBuffer(buffer.length);
  var aView = new Int8Array(aBuff);

  for(var j = 0; j < buffer.length; j++) {
    aView[j] = buffer[j];
    if(buffer[j] === 10) {
      packetOffset = j;
    }
  }

  aBuff = aBuff.slice(packetOffset + 1);

  var packetAudio = new Int16Array(aBuff);

  return packetAudio;
};

AudioRouterClient.prototype.splitAudioPacketBrowser =
  function splitAudioPacketBrowser(buffer) {
  var packetAudio = [];

  var packet = new Uint8Array(buffer);
  for(var i = 0; i < packet.length; i++) {
    if(packet[i] === 10) {
      packetAudio = buffer.slice(i + 1);
      break;
    }
  }

  return packetAudio;
};

AudioRouterClient.prototype.serializeAudioHeader =
  function serializeAudioHeader(bufferLength) {
  var client = this;

  var audioHeader = {
    acnt: client._account,
    rm: client._room,
    ppt: client._participant,
    cnt: bufferLength,
    rate: client._rate
  };
  var serialized = JSON.stringify(audioHeader);

  return serialized;
};

AudioRouterClient.prototype.setStream = function setStream(stream) {
  var client = this;
  if (client._protocol === 'peer') {
    client._net.setStream(stream);
  }
};

AudioRouterClient.prototype._open = function _open() {
  var client = this;

  client._sock.emit('setup', {
    udp: client._udp,
    protocol: client._protocol,
    account: client._account,
    room: client._room,
    participant: client._participant
  });
};

AudioRouterClient.prototype._ready = function _ready(ice) {
  var client = this;

  clearTimeout(client._clientConnectionTimeout);
  clearTimeout(client._clientConnectionFailure);

  var options = {
    account: client._account,
    room: client._room,
    participant: client._participant,
    wsUrlBinary: client._wsUrlBinary,
    sock: client._sock,
    ice: ice
  };
  if (client._protocol === 'peer') {
    client._net = new PCClient(options);
  }
  else {
    client._net = new WSClient(options);
  }

  client._net.on(MSG.ready, function netConnected() {
    debug('Net is now ready');
    client.emit(MSG.ready);
  });

  client._net.on(MSG.connected, function netConnected() {
    debug('Net is now connected');
    client.emit(MSG.connected);
  });

  client._net.on('audio', client._onAudio.bind(client));

  client._net.on(MSG.disconnected, function netDisconnected() {
    debug('Net disconnected');
    client.emit(MSG.disconnected);
  });

  client._net.on(MSG.connectionTimeout, function netTimeout() {
    client._timeout(new Error('Net connection timeout'));
  });

  client._net.on(MSG.connectionFailure, function netFailure() {
    client._failure(new Error('Net connection failure'));
  });
};

AudioRouterClient.prototype._onAudio = function _onAudio(data) {
  var client = this;
  client._metrics.PACKETS_RX++;
  var audio;
  if(BROWSER) {
    audio = client.splitAudioPacketBrowser(data);
  }
  else {
    audio = client.splitAudioPacket(data);
  }
  client._metrics.SAMPLES_RX += audio.byteLength / 2;
  client.emit(MSG.audioMessage, audio);
};

AudioRouterClient.prototype._closed = function _closed() {
  var client = this;
  if (client._net) {
    client._net.close();
  }
  client.emit('disconnected');
  if (client._pingInterval) {
    clearInterval(client._pingInterval);
  }
  debug('Disconnected from server');
};

AudioRouterClient.prototype._error = function _error(err) {
  var client = this;
  debug('Socket.io Error', err);
  client.emit('error', err);
};

AudioRouterClient.prototype._timeout = function _timeout(err) {
  var client = this;
  debug('connection timed out', err);
  client.emit(MSG.connectionTimeout, err);
};

AudioRouterClient.prototype._failure = function _failure(err) {
  var client = this;
  debug('connection failed', err);
  client.emit(MSG.connectionFailure, err);
};

AudioRouterClient.prototype.setMicEnable = function setMicEnable(micEnable) {
  var client = this;
  debug('Setting microphone enable', micEnable);
  client._sock.emit('setMicEnable', micEnable);
}

AudioRouterClient.prototype.setSpkrEnable = function setSpkrEnable(spkrEnable) {
  var client = this;
  debug('Setting speaker enable', spkrEnable);
  client._sock.emit('setSpkrEnable', spkrEnable);
}

AudioRouterClient.prototype._setupEventHandlers =
    function _setupEventHandlersProtoType() {
  var client = this;
  client._sock.on('connect', client._open.bind(client));
  client._sock.on('ready', client._ready.bind(client));
  client._sock.on('reconnect', client._open.bind(client));
  client._sock.on('disconnect', client._closed.bind(client));
  client._sock.on('connect_timeout', client._timeout.bind(client));
  client._sock.on('reconnect_failed', client._failure.bind(client));
  client._sock.on('reconnect_error', client._error.bind(client));
  client._sock.on('error', client._error.bind(client));
};
