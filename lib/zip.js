// Minimal ZIP writer (store method, no compression) so a published movie can
// be downloaded as one file without adding a dependency. Videos and images
// are already compressed, so "store" costs almost nothing in size.
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer, previous = 0) {
    let crc = (previous ^ 0xFFFFFFFF) >>> 0;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function fileCrc32(filePath) {
    let crc = 0;
    for await (const chunk of fs.createReadStream(filePath)) crc = crc32(chunk, crc);
    return crc;
}

function dosDateTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
        time: ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1F),
        date: (((year - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F)
    };
}

// Lists every file under `dir` as { name, path } with forward-slash names.
async function listFiles(dir, prefix = '') {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = path.join(dir, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...await listFiles(abs, name));
        else if (entry.isFile()) files.push({ name, path: abs });
    }
    return files;
}

function writeChunk(output, buffer) {
    return new Promise((resolve, reject) => {
        const ok = output.write(buffer, err => { if (err) reject(err); });
        if (ok) resolve();
        else output.once('drain', resolve);
    });
}

// Streams a ZIP archive of `files` ([{ name, path }]) into `output`.
async function writeZip(files, output) {
    const central = [];
    let offset = 0;
    for (const file of files) {
        const stat = await fs.promises.stat(file.path);
        if (stat.size >= 0xFFFFFFFF || offset >= 0xFFFFFFFF) {
            throw Object.assign(new Error('Export is too large to zip (4 GB limit)'), { statusCode: 413 });
        }
        const crc = await fileCrc32(file.path);
        const name = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
        const { time, date } = dosDateTime(stat.mtime);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(0x0800, 6);      // UTF-8 names
        local.writeUInt16LE(0, 8);           // store
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(stat.size, 18);
        local.writeUInt32LE(stat.size, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        await writeChunk(output, local);
        await writeChunk(output, name);
        for await (const chunk of fs.createReadStream(file.path)) await writeChunk(output, chunk);

        central.push({ name, crc, size: stat.size, time, date, offset });
        offset += local.length + name.length + stat.size;
    }

    let centralSize = 0;
    for (const entry of central) {
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);         // version made by
        header.writeUInt16LE(20, 6);         // version needed
        header.writeUInt16LE(0x0800, 8);
        header.writeUInt16LE(0, 10);
        header.writeUInt16LE(entry.time, 12);
        header.writeUInt16LE(entry.date, 14);
        header.writeUInt32LE(entry.crc, 16);
        header.writeUInt32LE(entry.size, 20);
        header.writeUInt32LE(entry.size, 24);
        header.writeUInt16LE(entry.name.length, 28);
        header.writeUInt16LE(0, 30);
        header.writeUInt16LE(0, 32);
        header.writeUInt16LE(0, 34);
        header.writeUInt16LE(0, 36);
        header.writeUInt32LE(0, 38);
        header.writeUInt32LE(entry.offset, 42);
        await writeChunk(output, header);
        await writeChunk(output, entry.name);
        centralSize += header.length + entry.name.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(output, end);
}

module.exports = { writeZip, listFiles, crc32 };
