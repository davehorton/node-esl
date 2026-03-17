const net = require('net');

const macros = module.exports = {
    testConnSend(args, expected, Connection) {
        return {
            topic: macros.getInboundConnection(Connection, function(o) {
                const t = this;
                o.conn.socket.once('data', (data) => {
                    t.callback(o, data);
                });

                o.conn.send.apply(o.conn, args);
            }),
            'writes correct data': function(o, data) {
                expect(data).to.equal(expected);
                o.conn.socket.end();
            }
        };
    },
    nextPort(port) {
        return port + 1;
    },
    getServer(options, cb) {
        if (!cb) {
            cb = options;
            options = {};
        }

        options.port   = options.port   || 8000;
        options.host   = options.host   || null;
        options.server = options.server || net.createServer(() => {});

        function onListen() {
            options.server.removeListener('error', onError);
            cb(null, options.server);
        }

        function onError(err) {
            options.server.removeListener('listening', onListen);

            if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') {
                return cb(err);
            }

            options.port = macros.nextPort(options.port);
            macros.getServer(options, cb);
        }

        options.server.once('error', onError);
        options.server.once('listening', onListen);
        options.server.listen(options.port, options.host);
    },
    //macro for creating an echo server and socket connected to it
    //useful for being able to send data to a socket listener by writing
    //to that socket
    getEchoServerSocket(cb) {
        //find an open port
        macros.getServer((err, server) => {
            if (err) return cb(err);

            //echo anything on the server connection
            server.on('connection', (c) => {
                c.pipe(c);
            });

            //create a client socket to the server
            const client = net.connect({ port: server.address().port }, () => {
                if (cb) cb(null, client, server);
            });
        });
    },
    getInboundConnection(Conn, cb) {
        macros.getEchoServerSocket((err, client, server) => {
            const conn = new Conn('localhost', server.address().port, 'ClueCon');

            if (cb) cb(err, conn);
        });
    }
};
