const { EventEmitter2 } = require('eventemitter2');
const net = require('net');
const crypto = require('crypto');
const xml2js = require('xml2js');
const esl = require('./esl');
const Event = require('./Event');
const Parser = require('./Parser');

//- function(host, port, password[, localAddress][, callback])
//Initializes a new instance of ESLconnection, and connects to the
// host $host on the port $port, and supplies $password to freeswitch.
//
//Intended only for an event socket in "Inbound" mode. In other words,
// this is only intended for the purpose of creating a connection to
// FreeSWITCH that is not initially bound to any particular call or channel.
//
//- function(socket[, callback])
//Initializes a new instance of ESLconnection, using an existing net.Socket.
//
//Intended only for Event Socket Outbound connections.
//
//NOTE: The Connection class only supports 1 connection from FSW, the second
//  ctor option will take in a net.Socket instance (gained from net.connect or
//  on a server's connection event). For multiple connections use esl.Server
class Connection extends EventEmitter2 {
    constructor(...args) {
        super({
            wildcard: true,
            delimiter: '::',
            ignoreErrors: true,
            maxListeners: 25
        });

        const len = args.length;

        //check if they passed a ready callback
        this.once('esl::ready', ((typeof args[len - 1] === 'function') ? args[len - 1] : this._noop));

        //reasonable defaults for values
        this.execAsync = false;
        this.execLock = false;
        this.connecting = true;
        this.authed = false;
        this.channelData = null;
        this.cmdCallbackQueue = [];
        this.apiCallbackQueue = [];

        //reconnect variables for inbound connections
        this.reconnectOpts = {};
        this.reconnectVars = {};

        //events required for the module to operate properly
        this.reqEvents = ['BACKGROUND_JOB', 'CHANNEL_EXECUTE_COMPLETE'];
        this.listeningEvents = [];

        //"Inbound" connection (going into FSW)
        if (len > 2 && len < 6) {
            //3 (host, port, password);
            //4 (host, port, password, localAddress | callback);
            //5 (host, port, password, localAddress, callback)

            this._inbound = true;
            this.reqEvents = [];
            this.password = args[2];

            this.connectOpts = {
                port: args[1],
                host: args[0]
            };
            if (len > 3 && typeof args[3] === 'string') {
                this.connectOpts.localAddress = args[3];
            }

            //connect to ESL Socket
            this.socket = net.createConnection(this.connectOpts, () => this._onConnect());
            this.socket.setKeepAlive(true);
            this.socket.on('error', (err) => this._onError(err));
        }
        //"Outbound" connection (coming from FSW)
        else if (len >= 1) { //1 (net.Socket); 2 (net.Socket, callback)
            this._inbound = false;

            this.socket = args[0];
            this.connecting = false;
            this._onConnect();

            this.send('connect');

            this.once('esl::event::CHANNEL_DATA::**', () => {
                this.emit('esl::ready');
            });

            this.socket.on('error', (err) => this._onError(err));
        }
        //Invalid arguments passed
        else {
            this.emit('error', new Error('Bad arguments passed to esl.Connection'));
        }

        //emit end when stream closes
        this.socket.on('close', () => {
            this.emit('esl::end');
            this.socket = null;
            if (this._inbound) {
                this._onConnectionGone();
            }
        });

        //handle logdata events
        this.on('esl::event::logdata', (log) => {
            esl._doLog(log);
        });

        //handle command reply callbacks
        this.on('esl::event::command::reply', (...cbArgs) => {
            if (this.cmdCallbackQueue.length === 0) return;

            const fn = this.cmdCallbackQueue.shift();

            if (fn && typeof fn === 'function')
                fn.apply(this, cbArgs);
        });

        //handle api response callbacks
        this.on('esl::event::api::response', (...cbArgs) => {
            if (this.apiCallbackQueue.length === 0) return;

            const fn = this.apiCallbackQueue.shift();

            if (fn && typeof fn === 'function')
                fn.apply(this, cbArgs);
        });
    }

    /*********************
     ** Lower-level ESL Specification
     ** http://wiki.freeswitch.org/wiki/Event_Socket_Library
     **********************/

    //Returns the UNIX file descriptor for the connection object,
    // if the connection object is connected. This is the same file
    // descriptor that was passed to new($fd) when used in outbound mode.
    socketDescriptor() {
        if (this._inbound) return null;
        return this.socket;
    }

    //Test if the connection object is connected. Returns `true` if connected, `false` otherwise.
    connected() {
        return (!this.connecting && !!this.socket);
    }

    //When FS connects to an "Event Socket Outbound" handler, it sends
    // a "CHANNEL_DATA" event as the first event after the initial connection.
    // getInfo() returns an ESLevent that contains this Channel Data.
    //
    //getInfo() returns NULL when used on an "Event Socket Inbound" connection.
    getInfo() {
        return this.channelData; //remains null on Inbound socket
    }

    //Sends a command to FreeSWITCH.
    //
    //Does not wait for a reply. You should immediately call recvEvent
    // or recvEventTimed in a loop until you get the reply. The reply
    // event will have a header named "content-type" that has a value
    // of "api/response" or "command/reply".
    //
    //To automatically wait for the reply event, use sendRecv() instead of send().
    //
    //NOTE: This is a FAF method of sending a command
    send(command, args) {
        try {
            const parts = [command];
            if (args) {
                Object.keys(args).forEach((key) => {
                    parts.push(`${key}: ${args[key]}`);
                });
            }
            parts.push('', '');
            this.socket.write(parts.join('\n'));
        }
        catch (e) {
            this.emit('error', e);
        }
    }

    //Internally sendRecv($command) calls send($command) then recvEvent(),
    // and returns an instance of ESLevent.
    //
    //recvEvent() is called in a loop until it receives an event with a header
    // named "content-type" that has a value of "api/response" or "command/reply",
    // and then returns it as an instance of ESLevent.
    //
    //Any events that are received by recvEvent() prior to the reply event are queued
    // up, and will get returned on subsequent calls to recvEvent() in your program.
    //
    //NOTE: This listens for a response when calling `.send()` doing recvEvent() in a loop
    //  doesn't make sense in the context of Node.
    sendRecv(command, args, cb) {
        if (typeof args === 'function') {
            cb = args;
            args = null;
        }

        //queue callback for command reply
        this.cmdCallbackQueue.push(cb);

        this.send(command, args);
    }

    //Send an API command (http://wiki.freeswitch.org/wiki/Mod_commands#Core_Commands)
    // to the FreeSWITCH server. This method blocks further execution until
    // the command has been executed.
    //
    //api($command, $args) is identical to sendRecv("api $command $args").
    api(command, args, cb) {
        if (typeof args === 'function') {
            cb = args;
            args = '';
        }

        if (args instanceof Array)
            args = args.join(' ');

        args = (args ? ' ' + args : '');

        //queue callback for api response
        this.apiCallbackQueue.push(cb);

        this.send('api ' + command + args);
    }

    //Send a background API command to the FreeSWITCH server to be executed in
    // its own thread. This will be executed in its own thread, and is non-blocking.
    //
    //bgapi($command, $args) is identical to sendRecv("bgapi $command $args")
    bgapi(command, args, jobid, cb) {
        if (typeof args === 'function') {
            cb = args;
            args = '';
            jobid = null;
        }

        if (typeof jobid === 'function') {
            cb = jobid;
            jobid = null;
        }

        args = args || ''; //in case they pass null/false

        if (args instanceof Array)
            args = args.join(' ');

        args = ' ' + args;

        jobid = jobid || crypto.randomUUID();

        const params = {};
        let addToFilter = (cb) => { if (cb) cb(); };
        let removeFromFilter = addToFilter;

        const sendApiCommand = (cb) => {
            params['Job-UUID'] = jobid;

            addToFilter(() => {
                if (cb) {
                    this.once('esl::event::BACKGROUND_JOB::' + jobid, (evt) => {
                        removeFromFilter(() => {
                            cb(evt);
                        });
                    });
                } else {
                    removeFromFilter();
                }
                this.sendRecv('bgapi ' + command + args, params);
            });
        };

        if (this.usingFilters) {
            addToFilter = (cb) => {
                this.filter('Job-UUID', jobid, cb);
            };
            removeFromFilter = (cb) => {
                this.filterDelete('Job-UUID', jobid, cb);
            };

            sendApiCommand(cb);
        }
        else {
            sendApiCommand(cb);
        }
    }

    //NOTE: This is a wrapper around sendRecv, that uses an ESLevent for the data
    sendEvent(event, cb) {
        this.sendRecv('sendevent ' + event.getHeader('Event-Name') + '\n' + event.serialize(), cb);
    }

    //Returns the next event from FreeSWITCH. If no events are waiting, this
    // call will block until an event arrives.
    //
    //NOTE: This is the same as `connection.once('esl::event::**', ...)` and in fact
    //  that is all it does. It does not block as the description says, nor does
    //  it queue events. Node has a better Event system than this, use it.
    recvEvent(cb) {
        cb = cb || this._noop;
        this.once('esl::event::**', cb);
    }

    //Similar to recvEvent(), except that it will block for at most $milliseconds.
    //
    //A call to recvEventTimed(0) will return immediately. This is useful for polling for events.
    //
    //NOTE: This does the same as recvEvent, except will timeout if an event isn't received in
    //  the specified timeframe
    recvEventTimed(ms, cb) {
        const fn = (to, event) => {
            clearTimeout(to);
            if (cb) cb(event);
        };

        const timeout = setTimeout(() => {
            this.removeListener('esl::event::**', fn);
            if (cb) cb();
        }, ms);

        //proxy to ensure we pass this timeout to the callback
        this.once('esl::event::**', fn.bind(this, timeout));
    }

    //See the event socket filter command (http://wiki.freeswitch.org/wiki/Event_Socket#filter).
    filter(header, value, cb) {
        this.usingFilters = true;
        this.sendRecv('filter ' + header + ' ' + value, cb);
    }

    filterDelete(header, value, cb) {
        if (typeof value === 'function') {
            cb = value;
            value = null;
        }

        this.sendRecv('filter delete ' + header + (value ? ' ' + value : ''), cb);
    }

    //$event_type can have the value "plain" or "xml" or "json". Any other value specified
    // for $event_type gets replaced with "plain".
    //
    //See the event socket event command for more info (http://wiki.freeswitch.org/wiki/Event_Socket#event).
    events(type, events, cb) {
        if (['plain', 'xml', 'json'].indexOf(type) === -1)
            type = 'plain';

        if (typeof events === 'function') {
            cb = events;
            events = 'all';
        }

        events = events || 'all';

        let all = false;
        if (events instanceof Array)
            all = (events.length === 1 && events[0].toLowerCase() === 'all');
        else
            all = (events.toLowerCase() === 'all');

        //if we specify all that includes required events
        if (all) {
            this.listeningEvents = ['all'];
        }
        //otherwise we need to concat the events to the required events
        else {
            this.listeningEvents = (events instanceof Array ? events : events.split(' '));

            for (let i = 0, len = this.reqEvents.length; i < len; ++i) {
                if (this.listeningEvents.indexOf(this.reqEvents[i]) !== -1)
                    continue;

                this.listeningEvents.push(this.reqEvents[i]);
            }
        }

        this.sendRecv('event ' + type + ' ' + this.listeningEvents.join(' '), cb);
    }

    //Execute a dialplan application (http://wiki.freeswitch.org/wiki/Mod_dptools#Applications),
    // and wait for a response from the server.
    execute(app, arg, uuid, cb) {
        const opts = {};

        if (typeof arg === 'function') {
            cb = arg;
            arg = '';
        }

        if (typeof uuid === 'function') {
            cb = uuid;
            uuid = null;
        }
        cb = cb || function() {};

        opts['execute-app-name'] = app;
        if (typeof arg !== 'undefined') { opts['execute-app-arg'] = arg; }

        let eventUuid;
        if (this._inbound) {
            uuid = uuid || crypto.randomUUID();
            eventUuid = this._doExec(uuid, 'execute', opts, cb);
        }
        else {
            uuid = this.getInfo().getHeader('Unique-ID');
            eventUuid = this._doExec(uuid, 'execute', opts, cb);
        }
        return eventUuid;
    }

    //Same as execute, but doesn't wait for a response from the server.
    //
    //This works by causing the underlying call to execute() to append
    // "async: true" header in the message sent to the channel.
    executeAsync(app, arg, uuid, cb) {
        const old = this.execAsync;
        this.execAsync = true;

        const eventUuid = this.execute(app, arg, uuid, cb);

        this.execAsync = old;

        return eventUuid;
    }

    //Force async mode on for a socket connection.
    setAsyncExecute(value) {
        this.execAsync = value;
    }

    //Force sync mode on for a socket connection.
    setEventLock(value) {
        this.execLock = value;
    }

    //Close the socket connection to the FreeSWITCH server.
    disconnect() {
        this.closing = true;
        this.send('exit');

        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }
    }

    /*********************
     ** Higher-level Library-Specific Functions
     ** Some of these simply provide syntactic sugar
     **********************/
    auth(cb) {
        this.sendRecv('auth ' + this.password, (evt) => {
            if (evt.getHeader('Modesl-Reply-OK') === 'accepted') {
                this.authed = true;

                if (this.reqEvents.length) this.subscribe(this.reqEvents);

                this.emit('esl::event::auth::success', evt);
                this.emit('esl::ready');

                if (cb && typeof cb === 'function') cb(null, evt);
            } else {
                this.authed = false;
                this.emit('esl::event::auth::fail', evt);

                if (cb && typeof cb === 'function') cb(new Error('Authentication Failed'), evt);
            }
        });
    }

    //subscribe to events using json format (native support)
    subscribe(events, cb) {
        events = events || 'all';
        this.events('json', events, cb);
    }

    //wraps the show mod_commands function and parses the return
    //value into a javascript array
    show(item, format, cb) {
        if (typeof format === 'function') {
            cb = format;
            format = null;
        }

        format = format || 'json';

        this.bgapi('show ' + item + ' as ' + format, (e) => {
            const data = e.getBody();
            let parsed = {};

            if (data.indexOf('-ERR') !== -1) {
                if (cb) cb(new Error(data));
                return;
            }

            switch (format) {
            case 'json':
                try { parsed = JSON.parse(data); }
                catch (err) { if (cb) cb(err); return; }

                if (!parsed.rows) parsed.rows = [];

                break;

            case 'xml': {
                const parser = new xml2js.Parser({ explicitArray: false, explicitRoot: false, emptyTag: '' });

                parser.parseString(data, (err, doc) => {
                    if (err) { if (cb) cb(err); return; }
                    parsed.rowCount = parseInt(doc.$.row_count, 10);
                    parsed.rows = [];

                    if (parsed.rowCount === 1) {
                        delete doc.row.$;
                        parsed.rows.push(doc.row);
                    } else if (parsed.rowCount > 1) {
                        doc.row.forEach((row) => {
                            delete row.$;
                            parsed.rows.push(row);
                        });
                    }
                });
                break;
            }

            default: {
                if (format.indexOf('delim')) {
                    const delim = format.replace('delim ', '');
                    const lines = data.split('\n');
                    const cols = lines[0].split(delim);

                    parsed = { rowCount: lines.length - 1, rows: [] };

                    for (let i = 1, len = lines.length; i < len; ++i) {
                        const vals = lines[i].split(delim);
                        const o = {};
                        for (let x = 0, xlen = vals.length; x < xlen; ++x) {
                            o[cols[x]] = vals[x];
                        }
                        parsed.rows.push(o);
                    }
                }
                break;
            }
            }

            if (cb) cb(null, parsed, data);
        });
    }

    //make an originating call
    originate(options, cb) {
        if (typeof options === 'function') {
            cb = options;
            options = null;
        }

        options.profile = options.profile || '';
        options.gateway = options.gateway || '';
        options.number  = options.number || '';
        options.app     = options.app || '';
        options.sync    = options.sync || false;

        const arg = 'sofia/' + options.profile +
                    '/' + options.number +
                    '@' + options.gateway +
                    (options.app ? ' &' + options.app : '');

        if (options.sync) {
            this.api('originate', arg, cb);
        } else {
            this.bgapi('originate', arg, cb);
        }
    }

    //send a SIP MESSAGE
    message(options, cb) {
        if (typeof options === 'function') {
            cb = options;
            options = null;
        }

        options = options || {};

        options.to      = options.to || '';
        options.from    = options.from || '';
        options.profile = options.profile || '';
        options.body    = options.body || '';
        options.subject = options.subject || '';
        options.deliveryConfirmation = options.deliveryConfirmation || '';

        const event = new Event('custom', 'SMS::SEND_MESSAGE');

        event.addHeader('proto', 'sip');
        event.addHeader('dest_proto', 'sip');

        event.addHeader('from', 'sip:' + options.from);
        event.addHeader('from_full', 'sip:' + options.from);

        event.addHeader('to', options.to);
        event.addHeader('sip_profile', options.profile);
        event.addHeader('subject', options.subject);

        if (options.deliveryConfirmation) {
            event.addHeader('blocking', 'true');
        }

        event.addHeader('type', 'text/plain');
        event.addHeader('Content-Type', 'text/plain');

        event.addBody(options.body);

        this.sendEvent(event, cb);
    }

    /*********************
     ** Private helpers
     **********************/
    //noop because EventEmitter2 makes me pass a function
    _noop() {}

    //helper for execute, sends the actual message
    _doExec(uuid, cmd, args, cb) {
        args['call-command'] = cmd;

        if (this.execAsync) args.async = true;
        if (this.execLock) args['event-lock'] = true;

        //this method of event tracking is based on:
        //http://lists.freeswitch.org/pipermail/freeswitch-users/2013-May/095329.html
        args['Event-UUID'] = crypto.randomUUID();

        const eventName = 'esl::event::CHANNEL_EXECUTE_COMPLETE::' + uuid;
        const cbWrapper = (evt) => {
            const evtUuid = evt.getHeader('Application-UUID') || evt.getHeader('Event-UUID');

            if (args['Event-UUID'] === evtUuid) {
                this.removeListener(eventName, cbWrapper);
                cb(evt);
            }
        };

        this.on(eventName, cbWrapper);

        this.send('sendmsg ' + uuid, args);

        return args['Event-UUID'];
    }

    //called on socket/generic error, simply echo the error to the user
    _onError(err) {
        this.emit('error', err);
        if (this._inbound && !this.closing) {
            this._onConnectionGone();
        }
    }

    //called when socket connects to FSW ESL Server
    //or when we successfully listen to the fd
    _onConnect() {
        //initialize parser
        this.parser = new Parser(this.socket);

        //on generic event
        this.parser.on('esl::event', (event, headers, body) => this._onEvent(event, headers, body));

        //on parser error
        this.parser.on('error', (err) => this._onError(err));

        //emit that we connected
        this.emit('esl::connect');
        this.connecting = false;

        //wait for auth request
        this.once('esl::event::auth::request', () => this.auth());

        if (this._inbound) {
            this.initializeRetryVars();
        }
    }

    //When we get a generic ESLevent from FSW
    _onEvent(event, headers, body) {
        let emit = 'esl::event';
        const uuid = event.getHeader('Job-UUID') || event.getHeader('Unique-ID') || event.getHeader('Core-UUID');

        //massage Content-Types into event names,
        //since not all events actually have an Event-Name
        //header; we have to make our own
        switch (headers['Content-Type']) {
        case 'auth/request':
            emit += '::auth::request';
            break;

        case 'command/reply':
            emit += '::command::reply';

            if (headers['Event-Name'] === 'CHANNEL_DATA') {
                if (!this._inbound) {
                    this.channelData = event;
                    this.emit('esl::event::CHANNEL_DATA' + (uuid ? '::' + uuid : ''), event);
                }
            }
            break;

        case 'log/data':
            emit += '::logdata';
            break;

        case 'text/disconnect-notice':
            emit += '::disconnect::notice';
            break;

        case 'api/response':
            emit += '::api::response';
            break;

        case 'text/event-json':
        case 'text/event-plain':
        case 'text/event-xml':
            emit += '::' + event.getHeader('Event-Name') + (uuid ? '::' + uuid : '');
            break;

        default:
            emit += '::raw::' + headers['Content-Type'];
        }

        this.emit(emit, event, headers, body);
    }

    initializeRetryVars() {
        this.reconnectVars.retryTimer = null;
        this.reconnectVars.retryTotaltime = 0;
        this.reconnectVars.retryDelay = 150;
        this.reconnectVars.retryBackoff = 1.7;
        this.reconnectVars.attempts = 1;
    }

    _onConnectionGone() {
        if (!this._inbound) return;

        // Ensure retry vars are initialized (they won't be if we never connected successfully)
        if (this.reconnectVars.retryDelay === undefined) {
            this.initializeRetryVars();
        }

        // If a retry is already in progress, just let that happen
        if (this.reconnectVars.retryTimer) {
            return;
        }

        // If this is a requested shutdown, then don't retry
        if (this.closing) {
            this.reconnectVars.retryTimer = null;
            return;
        }

        const nextDelay = Math.floor(this.reconnectVars.retryDelay * this.reconnectVars.retryBackoff);
        if (this.reconnectOpts.retryMaxDelay !== null && nextDelay > this.reconnectOpts.retryMaxDelay) {
            this.reconnectVars.retryDelay = this.reconnectOpts.retryMaxDelay;
        } else {
            this.reconnectVars.retryDelay = nextDelay;
        }

        if (this.reconnectOpts.maxAttempts && this.reconnectVars.attempts >= this.reconnectOpts.maxAttempts) {
            this.reconnectVars.retryTimer = null;
            return;
        }

        this.reconnectVars.attempts += 1;
        this.emit('esl::reconnecting', {
            delay: this.reconnectVars.retryDelay,
            attempt: this.reconnectVars.attempts
        });
        this.reconnectVars.retryTimer = setTimeout(() => {
            this.reconnectVars.retryTotaltime += this.reconnectVars.retryDelay;

            if (this.reconnectOpts.connectTimeout &&
                this.reconnectVars.retryTotaltime >= this.reconnectOpts.connectTimeout) {
                this.reconnectVars.retryTimer = null;
                const elapsed = this.reconnectVars.retryTotaltime;
                console.error(
                    `Connection#_onConnectionGone: Couldn't get freeswitch connection after ${elapsed} ms`
                );
                return;
            }
            this.socket = net.createConnection(this.connectOpts, () => this._onConnect());
            this.socket.setKeepAlive(true);
            this.socket.on('error', (err) => this._onError(err));
            this.socket.on('close', () => {
                this.emit('esl::end');
                this.socket = null;
                this._onConnectionGone();
            });

            this.reconnectVars.retryTimer = null;
        }, this.reconnectVars.retryDelay);
    }
}

module.exports = Connection;
