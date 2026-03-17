'use strict';

const { EventEmitter } = require('events');
const Parser = require('../lib/esl/Parser');
const Event = require('../lib/esl/Event');

// --- Build realistic ESL protocol data ---

// 1. A command/reply (auth request) - small, no body
const authRequest = Buffer.from(
    'Content-Type: auth/request\n\n'
);

// 2. A command/reply with Reply-Text
const cmdReply = Buffer.from(
    'Content-Type: command/reply\n' +
    'Reply-Text: +OK accepted\n\n'
);

// 3. A JSON event with ~30 headers (typical CHANNEL_EXECUTE_COMPLETE)
const jsonEventBody = JSON.stringify({
    'Event-Name': 'CHANNEL_EXECUTE_COMPLETE',
    'Core-UUID': '8b192020-7368-4498-9b11-cbe10f48a784',
    'FreeSWITCH-Hostname': 'freeswitch-prod-01',
    'FreeSWITCH-Switchname': 'freeswitch-prod-01',
    'FreeSWITCH-IPv4': '10.0.1.50',
    'FreeSWITCH-IPv6': '::1',
    'Event-Date-Local': '2024-01-15 10:30:45',
    'Event-Date-GMT': 'Mon, 15 Jan 2024 15:30:45 GMT',
    'Event-Date-Timestamp': '1705329045036551',
    'Event-Calling-File': 'switch_core_state_machine.c',
    'Event-Calling-Function': 'switch_core_session_exec',
    'Event-Calling-Line-Number': '620',
    'Event-Sequence': '154832',
    'Channel-State': 'CS_EXECUTE',
    'Channel-Call-State': 'ACTIVE',
    'Channel-State-Number': '4',
    'Channel-Name': 'sofia/external/+15551234567@10.0.1.100',
    'Unique-ID': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Call-Direction': 'inbound',
    'Caller-Caller-ID-Name': 'Test User',
    'Caller-Caller-ID-Number': '+15551234567',
    'Caller-Destination-Number': '+15559876543',
    'Caller-Network-Addr': '10.0.1.241',
    'Channel-Read-Codec-Name': 'PCMU',
    'Channel-Read-Codec-Rate': '8000',
    'Channel-Write-Codec-Name': 'PCMU',
    'Channel-Write-Codec-Rate': '8000',
    'Application': 'bridge',
    'Application-Data': 'sofia/gateway/carrier/+15559876543',
    'Application-Response': '_none_',
    'Content-Length': 0
});

const jsonEvent = Buffer.from(
    'Content-Type: text/event-json\n' +
    `Content-Length: ${Buffer.byteLength(jsonEventBody)}\n\n` +
    jsonEventBody
);

// 4. A plain event (HEARTBEAT - frequent in production)
const plainBody =
    'Event-Name: HEARTBEAT\n' +
    'Core-UUID: 8b192020-7368-4498-9b11-cbe10f48a784\n' +
    'FreeSWITCH-Hostname: freeswitch-prod-01\n' +
    'FreeSWITCH-IPv4: 10.0.1.50\n' +
    'Event-Date-Local: 2024-01-15 10:30:45\n' +
    'Event-Date-GMT: Mon, 15 Jan 2024 15:30:45 GMT\n' +
    'Event-Date-Timestamp: 1705329045036551\n' +
    'Event-Sequence: 154833\n' +
    'FreeSWITCH-Version: 1.10.9\n' +
    'Up-Time: 0 years, 45 days, 3 hours\n' +
    'Session-Count: 287\n' +
    'Session-Per-Sec: 42\n' +
    'Session-Per-Sec-Last: 38\n' +
    'Session-Per-Sec-Max: 156\n' +
    'Session-Per-Sec-FiveMin: 41\n' +
    'Session-Since-Startup: 1548320\n' +
    'Idle-CPU: 85.300000\n';

const plainEvent = Buffer.from(
    'Content-Type: text/event-plain\n' +
    `Content-Length: ${Buffer.byteLength(plainBody)}\n\n` +
    plainBody
);

// 5. A channel data reply (outbound connection handshake - 40+ headers)
const channelData = Buffer.from(
    'Content-Type: command/reply\n' +
    'Socket-Mode: async\n' +
    'Control: full\n' +
    'Event-Name: CHANNEL_DATA\n' +
    'Channel-Username: 1001\n' +
    'Channel-Dialplan: XML\n' +
    'Channel-Caller-ID-Name: 1001\n' +
    'Channel-Caller-ID-Number: 1001\n' +
    'Channel-Network-Addr: 10.0.1.241\n' +
    'Channel-Destination-Number: 886\n' +
    'Channel-Unique-ID: 40117b0a-186e-11dd-bbcd-7b74b6b4d31e\n' +
    'Channel-Source: mod_sofia\n' +
    'Channel-Context: default\n' +
    'Channel-Channel-Name: sofia/default/1001%4010.0.1.100\n' +
    'Channel-Profile-Index: 1\n' +
    'Channel-Channel-Created-Time: 1209749769132614\n' +
    'Channel-Channel-Answered-Time: 0\n' +
    'Channel-Channel-Hangup-Time: 0\n' +
    'Channel-Channel-Transfer-Time: 0\n' +
    'Channel-Screen-Bit: yes\n' +
    'Channel-Privacy-Hide-Name: no\n' +
    'Channel-Privacy-Hide-Number: no\n' +
    'Channel-State: CS_EXECUTE\n' +
    'Channel-State-Number: 4\n' +
    'Channel-Name: sofia/default/1001%4010.0.1.100\n' +
    'Unique-ID: 40117b0a-186e-11dd-bbcd-7b74b6b4d31e\n' +
    'Call-Direction: inbound\n' +
    'Answer-State: early\n' +
    'Channel-Read-Codec-Name: G722\n' +
    'Channel-Read-Codec-Rate: 16000\n' +
    'Channel-Write-Codec-Name: G722\n' +
    'Channel-Write-Codec-Rate: 16000\n' +
    'Caller-Username: 1001\n' +
    'Caller-Dialplan: XML\n' +
    'Caller-Caller-ID-Name: 1001\n' +
    'Caller-Caller-ID-Number: 1001\n' +
    'Caller-Network-Addr: 10.0.1.241\n' +
    'Caller-Destination-Number: 886\n' +
    'Caller-Unique-ID: 40117b0a-186e-11dd-bbcd-7b74b6b4d31e\n' +
    'Caller-Source: mod_sofia\n' +
    'Caller-Context: default\n' +
    'Caller-Channel-Name: sofia/default/1001%4010.0.1.100\n' +
    'Caller-Profile-Index: 1\n' +
    'Caller-Channel-Created-Time: 1209749769132614\n' +
    'Caller-Channel-Answered-Time: 0\n' +
    'Caller-Channel-Hangup-Time: 0\n' +
    'Caller-Channel-Transfer-Time: 0\n' +
    'Caller-Screen-Bit: yes\n' +
    'Caller-Privacy-Hide-Name: no\n' +
    'Caller-Privacy-Hide-Number: no\n\n'
);

// --- Mock socket that behaves like a net.Socket ---
class MockSocket extends EventEmitter {
    write() {}
    setKeepAlive() {}
    end() {}
}

// --- Benchmark harness ---
function runBenchmark(name, dataBuffer, iterations) {
    // Warmup
    for (let i = 0; i < 100; i++) {
        const sock = new MockSocket();
        const parser = new Parser(sock);
        parser.on('esl::event', () => {});
        sock.emit('data', dataBuffer);
        sock.removeAllListeners();
    }

    // Force GC before measurement
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();
    const startTime = process.hrtime.bigint();

    let eventCount = 0;

    for (let i = 0; i < iterations; i++) {
        const sock = new MockSocket();
        const parser = new Parser(sock);
        parser.on('esl::event', () => { eventCount++; });
        sock.emit('data', dataBuffer);
        sock.removeAllListeners();
    }

    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6; // ms

    if (global.gc) global.gc();
    const memAfter = process.memoryUsage();

    const eventsPerSec = Math.round((eventCount / elapsed) * 1000);
    const heapDelta = ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2);
    const perEvent = (elapsed / eventCount).toFixed(4);

    return { name, eventCount, elapsed: elapsed.toFixed(1), eventsPerSec, perEvent, heapDelta };
}

// Benchmark: feed data in small chunks (simulates TCP fragmentation)
function runChunkedBenchmark(name, dataBuffer, chunkSize, iterations) {
    const chunks = [];
    for (let i = 0; i < dataBuffer.length; i += chunkSize) {
        chunks.push(dataBuffer.subarray(i, Math.min(i + chunkSize, dataBuffer.length)));
    }

    // Warmup
    for (let i = 0; i < 100; i++) {
        const sock = new MockSocket();
        const parser = new Parser(sock);
        parser.on('esl::event', () => {});
        for (const chunk of chunks) {
            sock.emit('data', chunk);
        }
        sock.removeAllListeners();
    }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();
    const startTime = process.hrtime.bigint();

    let eventCount = 0;

    for (let i = 0; i < iterations; i++) {
        const sock = new MockSocket();
        const parser = new Parser(sock);
        parser.on('esl::event', () => { eventCount++; });
        for (const chunk of chunks) {
            sock.emit('data', chunk);
        }
        sock.removeAllListeners();
    }

    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;

    if (global.gc) global.gc();
    const memAfter = process.memoryUsage();

    const eventsPerSec = Math.round((eventCount / elapsed) * 1000);
    const heapDelta = ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2);
    const perEvent = (elapsed / eventCount).toFixed(4);

    return { name, eventCount, elapsed: elapsed.toFixed(1), eventsPerSec, perEvent, heapDelta };
}

// Benchmark: Event header lookups
function runEventBenchmark(iterations) {
    // Build a realistic event with ~30 headers
    const headers = {
        'Event-Name': 'CHANNEL_EXECUTE_COMPLETE',
        'Core-UUID': '8b192020-7368-4498-9b11-cbe10f48a784',
        'FreeSWITCH-Hostname': 'freeswitch-prod-01',
        'Unique-ID': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'Channel-State': 'CS_EXECUTE',
        'Channel-Name': 'sofia/external/+15551234567@10.0.1.100',
        'Call-Direction': 'inbound',
        'Caller-Caller-ID-Name': 'Test User',
        'Caller-Caller-ID-Number': '+15551234567',
        'Caller-Destination-Number': '+15559876543',
        'Application': 'bridge',
        'Application-Response': '_none_',
        'Job-UUID': 'deadbeef-1234-5678-9abc-def012345678',
        'Reply-Text': '+OK accepted',
        'Content-Type': 'text/event-json',
        'variable_sip_to_uri': 'sip:+15559876543@10.0.1.100',
        'variable_sip_from_uri': 'sip:+15551234567@10.0.1.241',
        'variable_sip_call_id': 'abc123@10.0.1.241',
        'variable_bridge_uuid': 'f1e2d3c4-b5a6-9807-6543-210fedcba987',
        'variable_endpoint_disposition': 'ANSWER',
    };

    // Warmup
    for (let i = 0; i < 1000; i++) {
        const evt = new Event(headers);
        evt.getHeader('Job-UUID');
        evt.getHeader('Unique-ID');
        evt.getHeader('Core-UUID');
        evt.getHeader('Reply-Text');
        evt.getHeader('Nonexistent-Header');
    }

    if (global.gc) global.gc();
    const startTime = process.hrtime.bigint();

    // Measure: creation + typical header lookups done in _onEvent
    for (let i = 0; i < iterations; i++) {
        const evt = new Event(headers);
        evt.getHeader('Job-UUID');
        evt.getHeader('Unique-ID');
        evt.getHeader('Core-UUID');
        evt.getHeader('Reply-Text');
        evt.getHeader('Event-Name');
        // Miss case
        evt.getHeader('Nonexistent-Header');
    }

    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;
    const opsPerSec = Math.round((iterations / elapsed) * 1000);
    const perOp = (elapsed / iterations).toFixed(4);

    return {
        name: 'Event create + 6 lookups',
        iterations,
        elapsed: elapsed.toFixed(1),
        opsPerSec,
        perOp
    };
}

// --- Run all benchmarks ---
const N_PARSER = 50_000;
const N_EVENT = 200_000;

console.log('node-esl performance benchmark');
console.log('==============================');
console.log(`Node ${process.version}, GC exposed: ${!!global.gc}`);
if (!global.gc) {
    console.log('  Tip: run with --expose-gc for memory measurements');
}
console.log('');

console.log('Parser benchmarks (full buffer - best case):');
console.log('---------------------------------------------');
const results = [
    runBenchmark('auth/request (no body)', authRequest, N_PARSER),
    runBenchmark('command/reply (no body)', cmdReply, N_PARSER),
    runBenchmark('JSON event (~30 hdrs)', jsonEvent, N_PARSER),
    runBenchmark('plain event (~18 hdrs)', plainEvent, N_PARSER),
    runBenchmark('channel data (~47 hdrs)', channelData, N_PARSER),
];

console.table(results.map((r) => ({
    'Test': r.name,
    'Events': r.eventCount,
    'Time (ms)': r.elapsed,
    'Events/sec': r.eventsPerSec.toLocaleString(),
    'ms/event': r.perEvent,
    'Heap delta (MB)': r.heapDelta,
})));

console.log('');
console.log('Parser benchmarks (64-byte chunks - simulates TCP fragmentation):');
console.log('------------------------------------------------------------------');
const chunkedResults = [
    runChunkedBenchmark('JSON event chunked', jsonEvent, 64, N_PARSER),
    runChunkedBenchmark('plain event chunked', plainEvent, 64, N_PARSER),
    runChunkedBenchmark('channel data chunked', channelData, 64, N_PARSER),
];

console.table(chunkedResults.map((r) => ({
    'Test': r.name,
    'Events': r.eventCount,
    'Time (ms)': r.elapsed,
    'Events/sec': r.eventsPerSec.toLocaleString(),
    'ms/event': r.perEvent,
    'Heap delta (MB)': r.heapDelta,
})));

console.log('');
console.log('Event benchmarks:');
console.log('-----------------');
const eventResult = runEventBenchmark(N_EVENT);
console.table([{
    'Test': eventResult.name,
    'Iterations': eventResult.iterations,
    'Time (ms)': eventResult.elapsed,
    'Ops/sec': eventResult.opsPerSec.toLocaleString(),
    'ms/op': eventResult.perOp,
}]);
