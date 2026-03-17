const data = require('../../fixtures/data');
const heads = JSON.parse(data.event.json);
const macros = require('../../fixtures/macros');
const Server = require('../../../lib/esl/Server');
const net = require('net');

describe('esl.Server', function() {
    it('should have the correct exports', function(done) {
        //is function
        expect(Server).to.be.a('function');

        const server = new Server();

        testServerInstance(server);

        server.on('ready', function() {
            server.close();
            done();
        });
    });

    it('should work with only a callback set', function(done) {
        const server = new Server(function() {
            server.close();
            done();
        });

        testServerInstance(server);
    });

    it('should use a custom server instance', function(done) {
        macros.getServer(function(err, server) {
            if (err) return done(err);

            const eslServer = new Server({ server: server }, function() {
                expect(eslServer.server).to.equal(server);

                eslServer.close();

                done();
            });
        });
    });

    describe('server events', function() {
        let server;

        before(function(done) {
            macros.getServer(function(err, netServer) {
                if (err) return done(err);

                server = new Server({ server: netServer }, function() {
                    done();
                });
            });
        });

        it('should emit connection::open event', function(done) {
            testServerEvent(done, server, 'connection::open');
        });

        it('should emit connection::ready event', function(done) {
            testServerEvent(done, server, 'connection::ready', data.event.channelData);
        });

        it('should emit connection::close event', function(done) {
            testServerEvent(done, server, 'connection::close');
        });

        after(function() {
            server.close();
        });
    });

    describe('bind events', function() {
        let evtServer;

        before(function(done) {
            macros.getServer(function(err, server) {
                if (err) return done(err);

                evtServer = new Server({ server: server, myevents: true }, function() {
                    done();
                });
            });
        });

        it('should expose the bindEvents interface', function() {
            expect(evtServer.bindEvents).to.equal(true);
        });

        it('should emit connection::open event', function(done) {
            testServerEvent(done, evtServer, 'connection::open');
        });

        it('should emit connection::ready event', function(done) {
            testServerEvent(done, evtServer, 'connection::ready', data.event.channelData);
        });

        it('should emit connection::close event', function(done) {
            testServerEvent(done, evtServer, 'connection::close');
        });

        after(function() {
            evtServer.close();
        });
    });
});

function testServerEvent(done, server, name, channelData) {
    let to;

    //setup event callback
    server.once(name, function(c, id) {
        clearTimeout(to);

        expect(id).to.not.be.null;
        done();
    });

    //setup timeout
    to = setTimeout(function() {
        done(new Error('Connection Timeout'));
    }, 1500);

    //create a connection
    const socket = net.connect({ port: server.port });

    if (channelData) {
        //when esl.Connection sends 'connect' event
        socket.on('data', function(buffer) {
            const str = buffer.toString();

            console.log(str);

            if (server.bindEvents) {
                if (str.indexOf('connect') !== -1) {
                    socket.write(channelData + '\n');
                } else if (str.indexOf('myevents') !== -1) {
                    socket.write(channelData + '\n');
                    socket.end();
                }
            } else if (str.indexOf('connect') !== -1) {
                //write channel data to it
                socket.write(channelData + '\n');
                socket.end();
            }
        });
    } else {
        socket.end();
    }
}

function testServerInstance(server) {
    //is instance
    expect(server).to.be.an.instanceof(Server);

    //private functions
    expect(server._onConnection).to.be.a('function');
    expect(server._onListening).to.be.a('function');
    expect(server._generateId).to.be.a('function');

    //var defaults
    expect(server.connections).to.be.an('object');
    expect(server.port).to.be.a('number');
    expect(server.host).to.equal('127.0.0.1');
}
