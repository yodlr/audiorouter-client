var yodlr = require('node-yodlr').tools;
var should = require('should');

var AudioRouterClient = require('../');

var wsPort = 4000;
var wsHost = 'localhost';
var udpPort = 4010;

describe('AudioRouterClient', function() {

  describe('Constructor', function() {
    var clientOpts = {
      wsUrlBinary: 'ws://'+wsHost+':'+wsPort,
      account: '000-account',
      room: '000-room',
      participant: '000-participant',
      rate: '000-rate'
    };

    it('should fail to create without options', function() {
      (function(){
        var client = new AudioRouterClient();
      }).should.throw('Cannot create AudioRouterClient. No options provided');
    });

    it('should fail to create without account', function() {
      (function(){
        var opts = yodlr.clone(clientOpts);
        delete opts.account;
        var client = new AudioRouterClient(opts);
      }).should.throw('Cannot create AudioRouterClient. No account provided');
    });

    it('should fail to create without room', function() {
      (function(){
        var opts = yodlr.clone(clientOpts);
        delete opts.room;
        var client = new AudioRouterClient(opts);
      }).should.throw('Cannot create AudioRouterClient. No room provided');
    });

    it('should fail to create without participant', function() {
      (function(){
        var opts = yodlr.clone(clientOpts);
        delete opts.participant;
        var client = new AudioRouterClient(opts);
      }).should.throw('Cannot create AudioRouterClient. No participant provided');
    });

    it('should fail to create without rate', function() {
      (function(){
        var opts = yodlr.clone(clientOpts);
        delete opts.rate;
        var client = new AudioRouterClient(opts);
      }).should.throw('Cannot create AudioRouterClient. No rate provided');
    });

    it('should be instance of AudioRouterClient', function(done) {
      var opts = yodlr.clone(clientOpts);
      var client = new AudioRouterClient(opts);

      client.should.be.an.instanceof(AudioRouterClient);
      client.on('closed', function() {
        done();
      });
      client.terminate();
    });

    it('should serialize audio header', function(done) {
      var opts = yodlr.clone(clientOpts);
      var client = new AudioRouterClient(opts);
      var data = [1, 12, 123, 1234];
      var audioData = new Int16Array(data);
      var headers;

      var toParse = client.serializeAudioHeader(audioData.length);
      try {
        headers = JSON.parse(toParse);
      }
      catch(e) {
        should.not.exist(e);
      }

      should.exist(headers);
      should.exist(headers.acnt);
      headers.acnt.should.eql(clientOpts.account);
      should.exist(headers.rm);
      headers.rm.should.eql(clientOpts.room);
      should.exist(headers.ppt);
      headers.ppt.should.eql(clientOpts.participant);
      should.exist(headers.cnt);
      headers.cnt.should.eql(data.length);
      client.terminate();
      done();
    });
  });
});
