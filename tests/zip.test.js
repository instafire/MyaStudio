const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const { writeZip, listFiles, crc32 } = require('../lib/zip');

test('crc32 matches the reference value', () => {
    assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
    // Incremental updates give the same result as one pass.
    assert.equal(crc32(Buffer.from('lo'), crc32(Buffer.from('hel'))), 0x3610a686);
});

test('writeZip produces a valid stored archive', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mya-zip-'));
    fs.mkdirSync(path.join(dir, 'clips'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
    fs.writeFileSync(path.join(dir, 'clips', 'a.txt'), 'hello');
    const files = await listFiles(dir);
    assert.deepEqual(files.map(file => file.name), ['clips/a.txt', 'index.html']);

    const chunks = [];
    const sink = new Writable({ write(chunk, enc, done) { chunks.push(chunk); done(); } });
    await writeZip(files.map(file => ({ name: `movie/${file.name}`, path: file.path })), sink);
    const zip = Buffer.concat(chunks);

    const end = zip.length - 22;
    assert.equal(zip.readUInt32LE(end), 0x06054b50);
    assert.equal(zip.readUInt16LE(end + 10), 2, 'two entries');
    const centralOffset = zip.readUInt32LE(end + 16);
    assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
    // First entry: clips/a.txt, stored, with the right CRC and size.
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(14), 0x3610a686);
    assert.equal(zip.readUInt32LE(18), 5);
    const nameLength = zip.readUInt16LE(26);
    assert.equal(zip.slice(30, 30 + nameLength).toString(), 'movie/clips/a.txt');
    assert.equal(zip.slice(30 + nameLength, 35 + nameLength).toString(), 'hello');
    fs.rmSync(dir, { recursive: true, force: true });
});
