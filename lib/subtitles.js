function srtToVtt(text) {
    const body = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (/^WEBVTT/m.test(body)) return body;
    const converted = body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + converted;
}

function looksLikeValidCues(vtt) {
    const head = String(vtt || '').slice(0, 200);
    return /WEBVTT/.test(head) && /\d{2}:\d{2}:\d{2}\.\d{3}/.test(String(vtt));
}

module.exports = { srtToVtt, looksLikeValidCues };
