const { EventEmitter2 } = require('eventemitter2');
const xml2js = require('xml2js');
const Event = require('./Event');

class Parser extends EventEmitter2 {
    constructor(socket) {
        super({
            wildcard: true,
            delimiter: '::',
            maxListeners: 25
        });

        this.bodyLen = 0;
        this.encoding = 'utf8';

        this.socket = socket;
        this.event = null;

        //buffer management: keep a list of chunks and only consolidate when needed
        this._chunks = [];
        this._chunksLen = 0;
        this._buffer = null;
        this._bufferOffset = 0;

        socket.on('data', (data) => this._onData(data));
        socket.on('end', () => this._onEnd());
    }

    //consolidate chunks into a single buffer for parsing
    _consolidate() {
        if (this._chunks.length === 0) {
            if (!this._buffer) {
                this._buffer = Buffer.alloc(0);
                this._bufferOffset = 0;
            }
            return;
        }

        //merge existing unconsumed buffer portion with new chunks
        const oldLen = this._buffer ? this._buffer.length - this._bufferOffset : 0;
        const totalLen = oldLen + this._chunksLen;
        const buf = Buffer.allocUnsafe(totalLen);

        if (oldLen > 0) {
            this._buffer.copy(buf, 0, this._bufferOffset);
        }

        let pos = oldLen;
        for (let i = 0, len = this._chunks.length; i < len; ++i) {
            this._chunks[i].copy(buf, pos);
            pos += this._chunks[i].length;
        }

        this._chunks.length = 0;
        this._chunksLen = 0;
        this._buffer = buf;
        this._bufferOffset = 0;
    }

    get bufferLength() {
        return (this._buffer ? this._buffer.length - this._bufferOffset : 0) + this._chunksLen;
    }

    _onData(data) {
        this._chunks.push(data);
        this._chunksLen += data.length;

        //if we have found a Content-Length header, parse as body
        if (this.bodyLen > 0)
            return this._parseBody();
        //otherwise this is more headers
        else
            return this._parseHeaders();
    }

    _onEnd() {
    }

    _indexOfHeaderEnd() {
        this._consolidate();
        const buf = this._buffer;
        const end = buf.length - 1;
        for (let i = this._bufferOffset; i < end; ++i) {
            if (buf[i] === 0x0a && buf[i + 1] === 0x0a) {
                return i - this._bufferOffset;
            }
        }
        return -1;
    }

    _parseHeaders() {
        //get end of header marker
        const headEnd = this._indexOfHeaderEnd();

        //if the headers haven't ended yet, keep buffering
        if (headEnd === -1) {
            return;
        }

        //if the headers have ended pull out the header text
        const headText = this._buffer.toString(this.encoding, this._bufferOffset, this._bufferOffset + headEnd);

        //advance past header text + \n\n
        this._bufferOffset += headEnd + 2;

        //parse text into object
        this.headers = this._parseHeaderText(headText);

        //if there is a body to parse, attempt to parse it if we have it in the buffer
        if (this.headers['Content-Length']) {
            //set bodyLen so next data event with process as body
            this.bodyLen = this.headers['Content-Length'];

            //continue processing the buffer as body
            if (this.bufferLength) this._parseBody();
        }
        //otherwise, this event is completed create an esl.Event object from it
        else {
            //an event is complete, emit it
            this._parseEvent(this.headers);

            //continue parsing the buffer
            if (this.bufferLength) this._parseHeaders();
        }
    }

    _parseBody() {
        //haven't buffered the entire body yet, buffer some more first
        if (this.bufferLength < this.bodyLen)
            return;

        this._consolidate();

        //pull out the body
        const body = this._buffer.toString(this.encoding, this._bufferOffset, this._bufferOffset + this.bodyLen);

        this._bufferOffset += this.bodyLen;
        this.bodyLen = 0;

        //reclaim memory if we've consumed most of the buffer
        if (this._bufferOffset > 65536) {
            this._buffer = this._buffer.subarray(this._bufferOffset);
            this._bufferOffset = 0;
        }

        //create the event object
        this._parseEvent(this.headers, body);

        //continue processing the buffer after the body of the previous event has been pulled out
        this._parseHeaders();
    }

    _parseHeaderText(txt) {
        const headers = {};
        let start = 0;

        for (;;) {
            const nlPos = txt.indexOf('\n', start);
            const line = nlPos === -1 ? txt.substring(start) : txt.substring(start, nlPos);
            if (line.length === 0) {
                if (nlPos === -1) break;
                start = nlPos + 1;
                continue;
            }

            const colonPos = line.indexOf(': ');
            let key, value;
            if (colonPos === -1) {
                key = line;
                value = '';
            } else {
                key = line.substring(0, colonPos);
                value = line.substring(colonPos + 2);
            }

            //only call decodeURIComponent when the value contains encoded characters
            if (value.indexOf('%') !== -1) {
                value = decodeURIComponent(value);
            }

            if (key === 'Content-Length') {
                headers[key] = parseInt(value, 10);
            } else {
                headers[key] = value;
            }

            if (nlPos === -1) break;
            start = nlPos + 1;
        }

        return headers;
    }

    _parseXmlBody(txt) {
        //in the form:
        //<event>
        //  <headers>...</headers>
        //  <Content-Length>4</Content-Length> [optional]
        //  <body>...</body> [optional]
        //</event>
        const parser = new xml2js.Parser({ explicitArray: false, explicitRoot: false });
        let headers = {};

        //parsing the xml is synchronous, despite the callback
        parser.parseString(txt, (err, data) => {
            if (err) {
                this.emit('error', err);
            }
            //do a little bit of massaging to get it into the same format
            //as what a JSON message looks like
            headers = data.headers;

            if (data.headers['Content-Length']) {
                headers['Content-Length'] = parseInt(data.headers['Content-Length'], 10);
                headers._body = data.body;
            }
        });

        return headers;
    }

    _parsePlainBody(txt) {
        //if the body is event-plain then it is just a bunch of key/value pairs
        const headerEnd = txt.indexOf('\n\n');
        const headers = this._parseHeaderText(txt.substring(0, headerEnd));

        if (headers['Content-Length']) {
            const len = parseInt(headers['Content-Length'], 10);
            const start = headerEnd + 2;
            const end = start + len;

            //extract body with byte length
            headers._body = Buffer.from(txt).subarray(start, end).toString(this.encoding);
        }

        return headers;
    }

    _parseEvent(headers, body) {
        let event, data;

        switch (headers['Content-Type']) {
        //parse body as JSON event data
        case 'text/event-json':
            try {
                data = JSON.parse(body);
                if (data['Content-Length'])
                    data['Content-Length'] = parseInt(data['Content-Length'], 10);
            }
            catch (e) { this.emit('error', e); }
            break;

        //parse body as PLAIN event data
        case 'text/event-plain':
            data = this._parsePlainBody(body);
            break;

        //parse body as XML event data
        case 'text/event-xml':
            data = this._parseXmlBody(body);
            break;
        }

        if (data)
            event = new Event(data);
        else
            event = new Event(headers, body);

        //try and massage an OK/Error message
        const reply = event.getHeader('Reply-Text');
        if (reply) {
            if (reply.indexOf('-ERR') === 0) {
                event.addHeader('Modesl-Reply-ERR', reply.substring(5));
            } else if (reply.indexOf('+OK') === 0) {
                event.addHeader('Modesl-Reply-OK', reply.substring(4));
            }
        }

        this.emit('esl::event', event, headers, body);
    }
}

module.exports = Parser;
