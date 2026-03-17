const encodeXml = require('../util/xml').encodeXml;

//can be (type {string}[, subclass {string}])
//or (headers {object/map}[, body {string}])
class Event {
    constructor(type, subclass) {
        this.headers = [];
        this.hPtr = null;

        //case where we actually have type/subclass
        if (typeof type === 'string') {
            this.type = type;
            this.subclass = subclass;
            this.body = '';

            this.addHeader('Event-Name', type);
            if (subclass) this.addHeader('Event-Subclass', subclass);
        }
        //case were we have headers/body
        else if (typeof type === 'object') {
            this.type = type['Event-Name'];
            this.subclass = type['Event-Subclass'];
            this.body = subclass || type._body || '';

            Object.keys(type).forEach((key) => {
                if (key === '_body') return;
                this.addHeader(key, type[key]);
            });
        }
        //case where we get no params
        else {
            this.type = '';
            this.subclass = null;
            this.body = '';
        }
    }

    //Turns an event into colon-separated 'name: value'
    // pairs similar to a sip/email packet
    // (the way it looks on '/events plain all').
    serialize(format) {
        format = format || 'plain';

        let data;

        switch (format) {
        case 'json':
            this.addHeader('Content-Length', Buffer.byteLength(this.body, 'utf8'));

            data = this.headers.reduce((d, header) => {
                d[header.name] = header.value;
                return d;
            }, {});

            if (this.body) {
                data._body = this.body;
            }

            return JSON.stringify(data, null, 2);

        case 'plain':
            this.addHeader('Content-Length', Buffer.byteLength(this.body, 'utf8'));

            data = this.headers.map((header) => `${header.name}: ${header.value}`).join('\n') + '\n';

            if (this.body) {
                data += '\n' + this.body;
            }

            return data;

        case 'xml': {
            const xmlEncodedBody = encodeXml(this.body);

            this.addHeader('Content-Length', Buffer.byteLength(xmlEncodedBody, 'utf8'));

            const parts = ['<event>', '  <headers>'];
            this.headers.forEach((header) => {
                const val = typeof header.value === 'string' ? encodeXml(header.value) : header.value;
                parts.push(`    <${header.name}>${val}</${header.name}>`);
            });
            parts.push('  </headers>');

            if (xmlEncodedBody) {
                parts.push(`  <body>${xmlEncodedBody}</body>`);
            }

            parts.push('</event>');

            return parts.join('\n');
        }
        }
    }

    //Sets the priority of an event to $number in case it's fired.
    //'NORMAL', 'LOW', 'HIGH', 'INVALID'
    setPriority(priority) {
        this.addHeader('priority', priority);
    }

    //Gets the header with the key of $header_name from an event object.
    getHeader(name) {
        const h = this._findHeader(name);
        return (h ? h.value : null);
    }

    //Gets the body of an event object.
    getBody() {
        return this.body;
    }

    //Gets the event type of an event object.
    getType() {
        return this.type;
    }

    //Add $value to the body of an event object.
    // This can be called multiple times for the same event object.
    addBody(value) {
        return this.body += value;
    }

    //Add a header with key = $header_name and value = $value
    // to an event object. This can be called multiple times
    // for the same event object.
    addHeader(name, value) {
        const h = this._findHeader(name);

        if (h) h.value = value;
        else this.headers.push({ name, value });

        return value;
    }

    //Delete the header with key $header_name from an event object.
    delHeader(name) {
        const i = this._findHeaderIndex(name);
        return (i === null ? null : this.headers.splice(i, 1));
    }

    //Sets the pointer to the first header in an event object,
    // and returns it's key name. This must be called before nextHeader is called.
    firstHeader() {
        this.hPtr = 0;
        return this.headers[0].name;
    }

    //Moves the pointer to the next header in an event object,
    // and returns it's key name. firstHeader must be called
    // before this method to set the pointer. If you're already
    // on the last header when this method is called, then it will return NULL.
    nextHeader() {
        if (this.hPtr === null) return null;

        if (this.hPtr === (this.headers.length - 1)) {
            this.hPtr = null;
            return null;
        }

        return this.headers[++this.hPtr].name;
    }

    _findHeaderIndex(name) {
        for (let i = 0, len = this.headers.length; i < len; ++i) {
            if (this.headers[i].name === name)
                return i;
        }
        return null;
    }

    _findHeader(name) {
        const i = this._findHeaderIndex(name);
        return (i === null ? null : this.headers[i]);
    }
}

Event.PRIORITY = {
    LOW: 'LOW',
    NORMAL: 'NORMAL',
    HIGH: 'HIGH'
};

module.exports = Event;
