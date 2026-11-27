// Thin fetch wrapper plus the upload helper (single request for normal files,
// small chunks for big ones so proxies with body limits never reject them).

export async function request(url, { method = 'GET', body, raw = false } = {}) {
    const init = { method, headers: {} };
    if (body instanceof FormData) {
        init.body = body;
    } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    let response;
    try {
        response = await fetch(url, init);
    } catch (err) {
        throw new Error('Can\'t reach MyaStudio. Is the server still running?');
    }
    if (raw) return response;
    let data = null;
    const text = await response.text();
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok || (data && data.error)) {
        const message = (data && data.error) || (response.status === 413 ? 'That file is too large.' : `Request failed (${response.status})`);
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return data;
}

export const api = {
    get: url => request(url),
    post: (url, body) => request(url, { method: 'POST', body: body || {} })
};

const SINGLE_SHOT_MAX = 90 * 1024 * 1024;
const CHUNK_SIZE = 5 * 1024 * 1024;
const HARD_MAX = 800 * 1024 * 1024;

function xhrUpload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.upload.onprogress = event => {
            if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
            let data = null;
            try { data = JSON.parse(xhr.responseText || 'null'); } catch (_) { data = null; }
            if (xhr.status >= 200 && xhr.status < 300 && !(data && data.error)) resolve(data);
            else reject(new Error((data && data.error) || (xhr.status === 413 ? 'That file is too large.' : `Upload failed (${xhr.status})`)));
        };
        xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
        xhr.send(formData);
    });
}

// SHA-256 of a blob, hex-encoded — the server verifies every chunk
// against this hash before appending it (see /api/upload/chunk).
async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// onProgress(fraction, phase) with phase 'upload' | 'processing'.
export async function uploadFile(file, projectId, onProgress = () => {}) {
    if (file.size > HARD_MAX) throw new Error(`${file.name} is larger than the 800 MB limit.`);
    if (file.size <= SINGLE_SHOT_MAX) {
        const form = new FormData();
        form.append('projectId', String(projectId));
        form.append('file', file);
        const result = await xhrUpload('/api/upload', form, fraction => {
            onProgress(fraction, fraction >= 1 ? 'processing' : 'upload');
        });
        return result;
    }
    const uploadId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    for (let index = 0; index < totalChunks; index++) {
        const slice = file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        const form = new FormData();
        form.append('uploadId', uploadId);
        form.append('chunkIndex', String(index));
        form.append('totalChunks', String(totalChunks));
        form.append('chunkHash', await sha256Hex(slice));
        form.append('chunk', slice, 'chunk.bin');
        let attempt = 0;
        for (;;) {
            try {
                await xhrUpload('/api/upload/chunk', form, fraction => onProgress((index + fraction) / totalChunks, 'upload'));
                break;
            } catch (err) {
                attempt += 1;
                if (attempt >= 3) throw err;
                await new Promise(resolve => setTimeout(resolve, 800 * attempt));
            }
        }
    }
    onProgress(1, 'processing');
    return request('/api/upload/complete', {
        method: 'POST',
        body: {
            uploadId,
            fileName: file.name,
            projectId,
            totalChunks,
            totalSize: file.size,
            mimeType: file.type || ''
        }
    });
}
