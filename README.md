# FreeSWITCH ESL Bindings for Node.js

A library for handling low-level FreeSWITCH ESL connections and associated events.

Published on npm as [`drachtio-modesl`](https://www.npmjs.com/package/drachtio-modesl).

Requires Node.js >= 22.

## Purpose

This library implements the full [Event Socket Library](http://wiki.freeswitch.org/wiki/Event_Socket_Library)
interface, providing a meaningful semantic when dealing with FreeSWITCH in Node.js.

It supports both **Inbound** (connection going _into_ FreeSWITCH) and **Outbound** (connections
coming _out_ of FreeSWITCH). The `esl.Server` helper manages multiple `esl.Connection` objects,
making it trivial to handle many simultaneous Outbound connections from FreeSWITCH.

## Installation

```shell
npm install drachtio-modesl
```

## Usage

### Inbound Connection

Connect to FreeSWITCH and send a status command:

```js
const { Connection } = require('drachtio-modesl');

const conn = new Connection('127.0.0.1', 8021, 'ClueCon', () => {
    conn.api('status', (res) => {
        // res is an esl.Event instance
        console.log(res.getBody());
    });
});
```

### Outbound Connection

Listen for connections from FreeSWITCH:

```js
const { Server } = require('drachtio-modesl');

const server = new Server({ port: 8022 }, () => {
    console.log('ESL server listening on port 8022');
});

server.on('connection::ready', (conn, id) => {
    console.log(`New connection: ${id}`);
    conn.execute('answer', '', () => {
        conn.execute('playback', '/path/to/file.wav');
    });
});
```

### api vs bgapi

All functions that interact with FreeSWITCH are asynchronous on the library side.
However, many commands (`api`, `execute`, etc.) are synchronous on the FreeSWITCH side.

- **`api`** — the callback fires immediately when the `command/reply` message is received, with all returned data.
- **`bgapi`** — FreeSWITCH returns `command/reply` immediately _before the command runs_. The library automatically tracks the command and fires the callback when the `BACKGROUND_JOB` message arrives.

The body for the same command issued via `api` and `bgapi` should be identical, even though headers, event type, and timing differ. The library smooths out these differences behind a common interface.

## API

### `Connection`

The main class. Operates in two modes:

- **Inbound**: `new Connection(host, port, password[, callback])` — connects to the FreeSWITCH ESL port.
- **Outbound**: `new Connection(socket[, callback])` — wraps a socket from FreeSWITCH (used by `Server`).

Key methods:

| Method | Description |
|--------|-------------|
| `send(command[, args])` | Send a command (fire-and-forget) |
| `sendRecv(command[, args], callback)` | Send a command and wait for a reply |
| `api(command[, args], callback)` | Send a blocking API command |
| `bgapi(command[, args][, jobid], callback)` | Send a background API command |
| `execute(app[, arg][, uuid], callback)` | Execute a dialplan application |
| `subscribe(events[, callback])` | Subscribe to events (JSON format) |
| `filter(header, value[, callback])` | Filter events |
| `disconnect()` | Close the connection |

Key events:

| Event | Description |
|-------|-------------|
| `esl::ready` | Connection is authenticated and ready |
| `esl::event::*` | Wildcard event namespace |
| `esl::end` | Connection closed |
| `error` | Error occurred |

Inbound connections automatically reconnect with exponential backoff.

### `Server`

Listens for Outbound connections from FreeSWITCH.

```js
new Server({ port, host, server, myevents })
```

| Event | Description |
|-------|-------------|
| `connection::open` | New socket connection |
| `connection::ready` | Connection authenticated and ready |
| `connection::close` | Connection closed |

### `Event`

Represents an ESL event (headers + body). Supports serialization to plain text, JSON, and XML.

| Method | Description |
|--------|-------------|
| `getHeader(name)` | Get a header value |
| `getBody()` | Get the event body |
| `getType()` | Get the event type |
| `addHeader(name, value)` | Add or update a header |
| `delHeader(name)` | Delete a header |
| `addBody(value)` | Append to the body |
| `serialize([format])` | Serialize to `'plain'`, `'json'`, or `'xml'` |

## Tests

```shell
npm test
```

## Benchmarks

Run the parser and event benchmark suite:

```shell
node bench/parser.js
```

Use `--expose-gc` for memory measurements:

```shell
node --expose-gc bench/parser.js
```

This benchmarks the ESL protocol parser and Event class across realistic scenarios: different event types (auth, command/reply, JSON, plain, channel data), full-buffer vs. 64-byte chunked delivery (simulating TCP fragmentation), and Event construction with header lookups.

## License

Dual-licensed under [MPL-2.0](http://www.mozilla.org/MPL/2.0/) or [MIT](https://opensource.org/licenses/MIT), at your option.
