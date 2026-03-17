const XML_ESCAPE_MAP = {
    '>': '&gt;',
    '<': '&lt;',
    '\'': '&apos;',
    '"': '&quot;',
    '&': '&amp;'
};

module.exports = {
    encodeXml(string) {
        if (!string) return '';

        return string.replace(/([&"<>\'])/g, (str, item) => XML_ESCAPE_MAP[item]);
    }
};
