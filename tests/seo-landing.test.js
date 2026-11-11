// SEO regression tests for the landing page (public/landing.html).
// Run with: npm test
// Covers TODO_seo-optimization.md items 1.1-1.10, 2.1-2.3, 3.3 (crawlability).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'landing.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

// Visible-text word count: strip scripts/styles, tags, and entities,
// then split on whitespace. Same method used for the 1,500-2,000 target.
function visibleText(s) {
    return s
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function wordCount(s) {
    const t = visibleText(s);
    return t ? t.split(' ').length : 0;
}
function jsonLdBlocks() {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map((m) => JSON.parse(m[1]));
}

describe('landing page SEO', () => {
    it('word count is between 1,500 and 2,000', () => {
        const n = wordCount(html);
        assert.ok(n >= 1500 && n <= 2000, `word count ${n} outside 1,500-2,000`);
    });

    it('title tag is <= 60 chars and contains the primary keyword', () => {
        const title = html.match(/<title>([\s\S]*?)<\/title>/)[1].trim();
        assert.ok(title.length <= 60, `title is ${title.length} chars`);
        assert.ok(title.toLowerCase().includes('interactive video maker'), title);
    });

    it('meta description is <= 160 chars and contains the primary keyword', () => {
        const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
        assert.ok(desc.length <= 160, `meta description is ${desc.length} chars`);
        assert.ok(desc.toLowerCase().includes('interactive video maker'), desc);
    });

    it('single H1, no <br> inside it, contains the primary keyword', () => {
        const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
        assert.equal(h1s.length, 1, `found ${h1s.length} H1s`);
        assert.ok(!h1s[0][1].includes('<br'), 'H1 contains a <br>');
        assert.ok(visibleText(h1s[0][1]).toLowerCase().includes('interactive video maker'));
    });

    it('heading hierarchy: at most 6 H4s (features grid only)', () => {
        const h4s = (html.match(/<h4/g) || []).length;
        assert.ok(h4s <= 6, `found ${h4s} H4s`);
    });

    it('primary keyword appears in the first 100 words of body text', () => {
        const first100 = visibleText(html).split(' ').slice(0, 100).join(' ').toLowerCase();
        assert.ok(first100.includes('interactive video maker'), first100.slice(0, 120));
    });

    it('secondary keywords distributed naturally', () => {
        // Hyphens normalized: "choose-your-own-adventure" counts as the
        // spaced phrase search engines see.
        const body = visibleText(html).toLowerCase().replace(/-/g, ' ');
        for (const kw of ['branching video', 'choose your own adventure', 'visual graph editor']) {
            assert.ok(body.includes(kw), `missing secondary keyword: ${kw}`);
        }
    });

    it('canonical tag present and points at the keyword slug', () => {
        const m = html.match(/<link rel="canonical" href="([^"]+)"/);
        assert.ok(m, 'no canonical tag');
        assert.ok(m[1].endsWith('/interactive-video-maker'), m[1]);
    });

    it('Open Graph image specified', () => {
        const m = html.match(/<meta property="og:image" content="([^"]+)"/);
        assert.ok(m, 'no og:image');
        assert.ok(m[1].endsWith('/og-image.png'), m[1]);
    });

    it('all inline SVGs have role="img" and aria-label', () => {
        const svgs = [...html.matchAll(/<svg[^>]*>/g)];
        assert.ok(svgs.length > 0, 'no SVGs found');
        for (const svg of svgs) {
            assert.ok(svg[0].includes('role="img"'), `SVG missing role="img": ${svg[0]}`);
            assert.ok(/aria-label="[^"]+"/.test(svg[0]), `SVG missing aria-label: ${svg[0]}`);
        }
    });

    it('internal links to / (app) and /feed/ with descriptive anchor text', () => {
        const links = [...html.matchAll(/<a href="(\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
        const byHref = {};
        for (const [, href, text] of links) {
            byHref[href] = visibleText(text);
        }
        assert.ok(byHref['/'] && byHref['/'].length > 10, `app link missing/undescriptive: ${byHref['/']}`);
        assert.ok(byHref['/feed/'] && byHref['/feed/'].length > 10, `feed link missing/undescriptive: ${byHref['/feed/']}`);
    });

    it('JSON-LD blocks parse: SoftwareApplication, FAQPage, Organization', () => {
        const blocks = jsonLdBlocks();
        const types = blocks.map((b) => b['@type']).sort();
        assert.deepEqual(types, ['FAQPage', 'Organization', 'SoftwareApplication']);
        const app = blocks.find((b) => b['@type'] === 'SoftwareApplication');
        assert.equal(app.name, 'Mya Studio');
        assert.equal(app.offers.price, '0');
        const org = blocks.find((b) => b['@type'] === 'Organization');
        assert.ok(org.url.startsWith('https://'), org.url);
    });

    it('FAQPage schema mirrors the visible FAQ questions', () => {
        const blocks = jsonLdBlocks();
        const faq = blocks.find((b) => b['@type'] === 'FAQPage');
        const visibleQs = [...html.matchAll(/<button[^>]*data-track="faq-open"[^>]*>([\s\S]*?)<\/button>/g)]
            .map((m) => visibleText(m[1]));
        const schemaQs = faq.mainEntity.map((q) => q.name);
        assert.equal(schemaQs.length, visibleQs.length, `schema has ${schemaQs.length} Qs, page has ${visibleQs.length}`);
        for (const q of visibleQs) {
            assert.ok(schemaQs.includes(q), `schema missing FAQ: ${q}`);
        }
        for (const q of faq.mainEntity) {
            assert.equal(q['@type'], 'Question');
            assert.equal(q.acceptedAnswer['@type'], 'Answer');
            assert.ok(q.acceptedAnswer.text.length > 20, q.name);
        }
    });

    it('keyword slug route exists in server.js and /landing.html is untouched by it', () => {
        assert.ok(serverJs.includes("app.get('/interactive-video-maker'"), 'no /interactive-video-maker route');
        assert.ok(serverJs.includes("res.sendFile(path.join(__dirname, 'public', 'landing.html'))"), 'route does not serve landing.html');
    });

    it('robots.txt and sitemap.xml exist and reference the canonical URL', () => {
        const robots = fs.readFileSync(path.join(root, 'public', 'robots.txt'), 'utf8');
        assert.ok(robots.includes('Sitemap: https://myastudio.genznewz.com/sitemap.xml'), robots);
        const sitemap = fs.readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8');
        assert.ok(sitemap.includes('https://myastudio.genznewz.com/interactive-video-maker'), sitemap);
        assert.ok(sitemap.includes('<urlset'), 'sitemap missing urlset');
    });

    it('og-image.png exists and is 1200x630', () => {
        const buf = fs.readFileSync(path.join(root, 'public', 'og-image.png'));
        assert.ok(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'not a PNG');
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        assert.equal(width, 1200, `width ${width}`);
        assert.equal(height, 630, `height ${height}`);
    });
});
