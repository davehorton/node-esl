const { EventEmitter2 } = require('eventemitter2');
const net = require('net');
const crypto = require('crypto');
const Connection = require('./Connection');

class Server extends EventEmitter2 {
    constructor(opts, readyCb) {
        super({
            wildcard: true,
            delimiter: '::',
            ignoreErrors: true,
            maxListeners: 25
        });

        if (typeof opts === 'function') {
            readyCb = opts;
            opts = null;
        }

        readyCb = readyCb || function() {};

        this.connections = {};

        //OR 0 will floor the value
        this.seq = Date.now() | 0;

        this.once('ready', readyCb);

        opts = opts || {};

        this.bindEvents = opts.myevents || false;

        if (opts.server) {
            this.port = opts.server.address().port;
            this.host = opts.server.address().host;

            this.server = opts.server;

            //make sure we dont call the callback before the function returns
            process.nextTick(() => {
                this.emit('ready');
            });

            this.server.on('connection', (socket) => this._onConnection(socket));
        }
        else {
            this.port = opts.port || 8022;
            this.host = opts.host || '127.0.0.1';

            this.server = net.createServer((socket) => this._onConnection(socket));
            this.server.listen(this.port, this.host, () => this._onListening());
        }
    }

    close(callback) {
        this.server.close(callback);
    }

    _onConnection(socket) {
        const conn = new Connection(socket);
        const id = this._generateId();

        this.connections[id] = conn;
        this.connections[id]._id = id;

        this.emit('connection::open', conn, id);

        conn.on('esl::ready', () => {
            if (this.bindEvents) {
                conn.sendRecv('myevents', () => {
                    this.emit('connection::ready', this.connections[id], id);
                });
            } else {
                this.emit('connection::ready', this.connections[id], id);
            }
        });

        conn.on('esl::end', () => {
            this.emit('connection::close', this.connections[id], id);
            delete this.connections[id];
        });
    }

    _onListening() {
        this.emit('ready');
    }

    _generateId() {
        const rand = Buffer.alloc(15); // multiple of 3 for base64

        //next in sequence
        this.seq = (this.seq + 1) | 0;

        //write sequence to last 4 bytes of buffer
        rand.writeInt32BE(this.seq, 11);

        //write random to first 11 bytes of buffer
        crypto.randomBytes(11).copy(rand);

        //make the base64 safe for an object property
        return rand.toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
    }

    getCountOfConnections() {
        return Object.keys(this.connections).length;
    }
}

module.exports = Server;
