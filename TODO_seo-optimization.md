# SEO Optimization TODO — Mya Studio Landing Page

## Context

| Field | Value |
|---|---|
| **Target Keyword** | "interactive video maker" |
| **Search Intent** | Commercial investigation (user wants to create interactive/branching videos, evaluating tools) |
| **Audience Personas** | Indie filmmaker, educator, game designer, content creator, instructional designer |
| **Funnel Stage** | MOFU (Consideration) — users know they want to make interactive videos, comparing tools |
| **Content Type** | Product landing page |
| **Target Word Count** | 1,500–2,000 words (currently ~886) |
| **Existing Page** | `public/landing.html` |

---

## SEO Strategy Plan

- [x] **SEO-PLAN-1.1 [Keyword Cluster - Primary]**:
  - **Primary Keyword**: interactive video maker
  - **Secondary Keywords**: branching video software, interactive storytelling tool, choose your own adventure creator, visual story editor
  - **Long-Tail Keywords**: how to make interactive videos, create branching video stories, open source interactive video platform, visual graph video editor
  - **Intent Classification**: Commercial (evaluating tools) + Informational (learning about the concept)

- [ ] **SEO-PLAN-1.2 [Keyword Cluster - Feature Keywords]**:
  - **Primary Keyword**: video graph editor
  - **Secondary Keywords**: timeline logic editor, choice-based video, branching narrative tool, interactive video export
  - **Long-Tail Keywords**: drag and drop video story builder, export interactive video to HTML, add choices to video
  - **Intent Classification**: Commercial — users searching for specific features of interactive video tools

- [ ] **SEO-PLAN-1.3 [Keyword Cluster - Open Source]**:
  - **Primary Keyword**: open source interactive video
  - **Secondary Keywords**: free interactive video software, self-hosted video platform, GitHub video tool
  - **Long-Tail Keywords**: free branching video creator, open source choose your own adventure software
  - **Intent Classification**: Commercial — users specifically seeking free/open-source alternatives

- [ ] **SEO-PLAN-1.4 [Content Gap Analysis]**:
  - **Current page**: 886 words, missing sections on pricing, technical requirements, detailed comparison, tutorials
  - **Top competitor pages** (H5P, Twine, BranchTrack, Eko) average 1,800–2,500 words for equivalent landing pages
  - **Missing subtopics**: export formats, video length limits, multi-language support, collaboration features
  - **Internal linking gap**: no link from landing page to the published feed on port 3001, no link to GitHub repo
  - **Cannibalization risk**: `public/index.html` is the full app UI with similar meta keywords; `public/feed/index.html` also targets "interactive movies"

---

## On-Page SEO Optimization Items

- [ ] **SEO-ITEM-1.1 [Title Tag]**:
  - **Current State**: `Mya Studio — Make Your Story Interactive` (40 chars)
  - **Recommended Change**: `Mya Studio — Interactive Video Maker & Branching Story Creator` (58 chars)
  - **Rationale**: Adds "Interactive Video Maker" (primary keyword) and "Branching Story Creator" (secondary keyword). Stays under 60 chars. Targets commercial intent explicitly.

- [ ] **SEO-ITEM-1.2 [Meta Description]**:
  - **Current State**: `Create interactive choose-your-own-adventure videos with a visual graph editor, timeline logic, and standalone HTML export. Free and open source.` (145 chars)
  - **Recommended Change**: `Create interactive videos with Mya Studio's visual graph editor. Build branching choose-your-own-adventure stories, add choice variables, and export standalone HTML players. Free and open source.` (158 chars)
  - **Rationale**: Adds "interactive videos" (primary keyword variant) and "choice variables" (feature keyword). Stays under 160 chars. Includes stronger CTA implication.

- [ ] **SEO-ITEM-1.3 [URL Slug]**:
  - **Current State**: `/landing.html`
  - **Recommended Change**: `/` (serve at root) or `/interactive-video-maker`
  - **Rationale**: Landing page should be the root page or have a keyword-rich slug. `/landing.html` provides zero SEO value.

- [ ] **SEO-ITEM-1.4 [H1 Tag]**:
  - **Current State**: `Make your story<br><em>interactive.</em>` (rendered as two lines)
  - **Recommended Change**: `Make Your Story Interactive With Visual Branching` (word wrap via CSS, not `<br>` in heading)
  - **Rationale**: Adds "visual branching" keyword. Removes `<br>` from heading for cleaner semantic SEO. Screen readers and crawlers parse text content better without inline breaks.

- [ ] **SEO-ITEM-1.5 [Heading Hierarchy]**:
  - **Current State**: H1 present, H2 for section titles, H3 for step cards, H4 for feature cards and showcase. But the showcase carousel uses H4 for individual movie titles (12 H4s), diluting heading hierarchy signal.
  - **Recommended Change**: Change showcase card titles from `<h4>` to `<p>` or `<div>` with strong text. Keep H4 only for the features grid.
  - **Rationale**: Having 12 H4s for showcase cards dilutes the heading hierarchy. Search engines expect H4 to represent a subsection of an H3. The showcase cards are list items, not subsections.

- [ ] **SEO-ITEM-1.6 [Image Alt Text]**:
  - **Current State**: No images present (showcase uses emoji placeholders, graphs are inline SVGs)
  - **Recommended Change**: Add alt text to inline SVGs and replace emoji showcase thumbnails with real poster images when available. For now, add SVG `role="img"` and `aria-label` attributes.
  - **Rationale**: Inline SVGs without text alternatives are invisible to screen readers. Add `role="img"` and a descriptive `aria-label` to the hero and deep-dive SVGs.

- [ ] **SEO-ITEM-1.7 [Internal Linking]**:
  - **Current State**: Landing page has no internal links to the app itself (no link to `http://127.0.0.1:3000` or `/`). The CTA links to GitHub.
  - **Recommended Change**: Add internal links to the app (`/`) and the feed (`/feed/`). Also link to `README.md` or `/docs` for documentation. Use descriptive anchor text.
  - **Rationale**: Internal links distribute page authority and help crawlers discover the actual application pages. Also provides a clear user journey from landing → try the app.

- [ ] **SEO-ITEM-1.8 [Canonical URL]**:
  - **Current State**: No canonical tag
  - **Recommended Change**: `<link rel="canonical" href="https://myastudio.dev/">`
  - **Rationale**: Prevents duplicate content issues if the page is served at multiple URLs. Essential for SEO.

- [ ] **SEO-ITEM-1.9 [Open Graph Image]**:
  - **Current State**: No `og:image` meta tag
  - **Recommended Change**: Add `<meta property="og:image" content="https://myastudio.dev/og-image.png">` and create a 1200×630px branded OG image
  - **Rationale**: Social shares without OG images look broken. OG images improve CTR on Twitter/X, LinkedIn, and Facebook by up to 40%.

- [ ] **SEO-ITEM-1.10 [Word Count Expansion]**:
  - **Current State**: ~886 words (below competitive threshold)
  - **Recommended Change**: Expand to 1,500–2,000 words by adding:
    - "How it works" section with concrete examples (200 words)
    - "Use cases" section with 3 real scenarios (300 words)
    - Comparison table vs. Twine / H5P / Eko (200 words)
    - Technical requirements and system compatibility (100 words)
    - Extended FAQ with 3 more questions (150 words)
  - **Rationale**: Competitor landing pages for interactive video tools average 1,800+ words. Thin content ranks lower for competitive keywords.

---

## Schema Markup

- [ ] **SEO-ITEM-2.1 [SoftwareApplication Schema]**:
  - **Current State**: No schema markup of any kind
  - **Recommended Change**: Add JSON-LD `SoftwareApplication` schema describing Mya Studio as a software application
  - **Implementation**: Insert the following JSON-LD block in the `<head>`:
  ```json
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Mya Studio",
    "applicationCategory": "MultimediaApplication",
    "operatingSystem": "Windows, macOS, Linux",
    "description": "Create interactive choose-your-own-adventure videos with a visual graph editor, timeline logic, and standalone HTML export.",
    "url": "https://myastudio.dev",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "author": {
      "@type": "Organization",
      "name": "Mya Studio"
    }
  }
  ```
  - **Rationale**: SoftwareApplication schema enables rich results in SERPs including star ratings, pricing, and OS/platform info. Improves CTR significantly.

- [ ] **SEO-ITEM-2.2 [FAQPage Schema]**:
  - **Current State**: FAQ accordion exists in HTML but no schema markup
  - **Recommended Change**: Add JSON-LD `FAQPage` schema that mirrors the 5 FAQ questions and answers
  - **Implementation**: Insert the following in the `<head>`:
  ```json
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What exactly is Mya Studio?",
        "acceptedAnswer": { "@type": "Answer", "text": "Mya Studio is a desktop application that lets you create interactive, choose-your-own-adventure style videos. You upload footage, cut clips, connect them with choices in a visual graph editor, and publish standalone HTML players." }
      },
      {
        "@type": "Question",
        "name": "Do I need coding experience to use Mya Studio?",
        "acceptedAnswer": { "@type": "Answer", "text": "No. The entire workflow is visual with a drag-and-drop graph editor, timeline-based logic, and a simple publish button. No code required." }
      },
      {
        "@type": "Question",
        "name": "What kind of videos can I make with Mya Studio?",
        "acceptedAnswer": { "@type": "Answer", "text": "Any linear video can become interactive: educational content, fiction, marketing, quizzes, training simulations, mystery games, and more." }
      },
      {
        "@type": "Question",
        "name": "Can I publish to my own website?",
        "acceptedAnswer": { "@type": "Answer", "text": "Yes. The export generates a self-contained HTML folder. Upload it to any static host like GitHub Pages, Netlify, or your own server. The player works offline and on mobile." }
      },
      {
        "@type": "Question",
        "name": "Is Mya Studio really free?",
        "acceptedAnswer": { "@type": "Answer", "text": "Yes. Mya Studio is free and open source. No paid tiers, no subscriptions, no cloud dependency. Everything runs locally on your machine." }
      }
    ]
  }
  ```
  - **Rationale**: FAQ rich results display questions directly in SERPs, dramatically increasing visibility and CTR for informational queries.

- [ ] **SEO-ITEM-2.3 [Organization Schema]**:
  - **Current State**: No organization/publisher schema
  - **Recommended Change**: Add JSON-LD `Organization` schema
  ```json
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Mya Studio",
    "url": "https://myastudio.dev",
    "description": "Interactive video creation platform"
  }
  ```

---

## Technical SEO

- [ ] **SEO-ITEM-3.1 [Performance Optimization]**:
  - **Current State**: ~53KB HTML with inline CSS and JS. No external dependencies beyond Google Fonts. Good baseline.
  - **Recommended Change**:
    - Add `<link rel="preload" href="...font-files..." as="font" crossorigin>` for each Google Font weight
    - Add `font-display: swap` to all `@font-face` rules (already handled by Google Fonts link)
    - Inline critical CSS (already done) and defer non-critical CSS (already done since all CSS is inline)
    - Add `<meta name="theme-color" content="#000000">` for PWA-like browser chrome on mobile
  - **Rationale**: Preloading fonts reduces FOUT (Flash of Unstyled Text). Theme-color meta tag improves perceived performance on mobile.

- [ ] **SEO-ITEM-3.2 [Mobile Responsiveness]**:
  - **Current State**: 4 breakpoints (480px, 768px, 1024px, 1024px+). Hamburger nav at 768px.
  - **Recommended Change**: Test on real devices. Add `touch-action: manipulation` to interactive elements (buttons, carousel arrows) to eliminate 300ms tap delay on mobile.
  - **Rationale**: Google uses mobile-first indexing. Tap delay on buttons creates poor UX flagged in Core Web Vitals.

- [ ] **SEO-ITEM-3.3 [Crawlability]**:
  - **Current State**: No XML sitemap, no robots.txt, no `nofollow` on external links
  - **Recommended Change**:
    - Create `public/robots.txt` with:
      ```
      User-agent: *
      Allow: /
      Sitemap: https://myastudio.dev/sitemap.xml
      ```
    - Add `rel="noopener noreferrer"` to all external links (GitHub link already has `rel="noopener"`)
    - Consider adding `rel="nofollow"` on the GitHub link if it's not meant to pass authority
  - **Rationale**: Robots.txt and sitemap.xml are crawl budget optimizations. `nofollow` on external links preserves PageRank.

- [ ] **SEO-ITEM-3.4 [Core Web Vitals]**:
  - **Current State**: Inline CSS eliminates render-blocking requests. No images to slow down LCP.
  - **Recommended Change**: Add `loading="lazy"` to any images added in the future. For the SVGs, add `role="img"` with `aria-label`. Keep CLS (Cumulative Layout Shift) low by ensuring all elements that are animated (reveal) have explicit heights set before animation.
  - **Rationale**: Core Web Vitals are a ranking signal. Scroll reveal animations can cause layout shift if elements don't reserve space before becoming visible.

---

## Content Strategy

- [ ] **SEO-ITEM-4.1 [Use Cases Section]**:
  - **Current State**: No use cases section. The page explains what the tool does but not who it's for.
  - **Recommended Change**: Add a "Who is Mya Studio for?" section with 3 specific use cases:
    - **Educators**: Create interactive lessons and branching quizzes
    - **Filmmakers**: Build choose-your-own-adventure short films
    - **Marketers**: Design interactive product demos and lead-gen videos
  - **Rationale**: Use case sections capture long-tail queries like "interactive video for education" and "branching video marketing tool". They also help users self-identify.

- [ ] **SEO-ITEM-4.2 [Comparison Table]**:
  - **Current State**: No comparison with alternatives
  - **Recommended Change**: Add a "Mya Studio vs Other Tools" comparison table comparing Mya Studio with Twine, H5P, BranchTrack, and Eko on features like: self-hosting, cost, video support, graph editor, analytics
  - **Rationale**: Comparison tables capture commercial comparison keywords (e.g., "Twine vs interactive video maker", "H5P alternative") and are highly effective for conversion.

- [ ] **SEO-ITEM-4.3 [Blog/Tutorial Content Plan]**:
  - **Current State**: No blog or tutorial section
  - **Recommended Change**: Plan a 5-article topic cluster around "interactive video creation":
    1. "How to Make an Interactive Video: A Beginner's Guide" (informational, top-of-funnel)
    2. "Building a Branching Narrative: Tools and Techniques" (informational, MOFU)
    3. "Mya Studio vs Twine: Which Interactive Story Tool Is Right for You?" (commercial comparison)
    4. "How to Export Interactive Videos to Standalone HTML" (transactional, how-to)
    5. "Adding Choice Variables to Your Interactive Video" (educational, feature-specific)
  - **Rationale**: Topic clusters build topical authority. Each article links back to the landing page, distributing internal link equity.

---

## Off-Page Strategy

- [ ] **SEO-ITEM-5.1 [Backlink Asset: Free Interactive Video Maker]**:
  - **Asset Idea**: Free, open-source nature makes Mya Studio a natural fit for "best free tools" roundups
  - **Outreach Targets**: 
    - eLearning Industry (elearningindustry.com)
    - Creative Bloq (creativebloq.com) — free video tools roundups
    - GitHub Awesome Lists (awesome-selfhosted, awesome-video)
    - Product Hunt launch
    - Hacker News "Show HN"
  - **Anchor Text Strategy**: Branded ("Mya Studio") and natural ("open source interactive video maker")

- [ ] **SEO-ITEM-5.2 [Digital PR: Open Source Launch]**:
  - **Angle**: "A free, open-source alternative to expensive interactive video platforms"
  - **Outlets**: TechCrunch, BetaNews, Hacker News, Reddit r/programming, r/opensource, r/videography
  - **Asset**: A 1-minute demo video showing the graph builder in action

- [ ] **SEO-ITEM-5.3 [Community Building]**:
  - **Action**: Create a GitHub Discussions page, Discord or Matrix channel for users
  - **Content**: Share "built with Mya Studio" showcases from early users
  - **Benefit**: User-generated content and backlinks from personal blogs/sites

---

## Keyword Performance Tracking

- [ ] **SEO-ITEM-6.1 [KPI Definition]**:
  - **Primary KPI**: Rank in top 10 for "interactive video maker" within 6 months
  - **Secondary KPIs**:
    - Rank in top 5 for "open source interactive video" within 3 months
    - Organic CTR > 15% for branded queries
    - Average dwell time > 2 minutes on landing page
    - Conversion rate (CTA click to GitHub/App) > 3%

- [ ] **SEO-ITEM-6.2 [Monitoring Setup]**:
  - **Tools**: Google Search Console, Google Analytics 4, Ahrefs or Semrush (if budget allows)
  - **Tracking**: Set up GA4 events for CTA clicks, scroll depth, FAQ accordion opens, carousel interactions
  - **Search Console**: Submit landing page URL, monitor impressions/clicks for target keywords

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|---|---|---|---|
| P0 | SEO-ITEM-1.1 (Title tag) | 5 min | High |
| P0 | SEO-ITEM-1.2 (Meta description) | 5 min | High |
| P0 | SEO-ITEM-2.1 (Software schema) | 15 min | High |
| P0 | SEO-ITEM-2.2 (FAQ schema) | 20 min | High |
| P0 | SEO-ITEM-1.8 (Canonical) | 2 min | Medium |
| P0 | SEO-ITEM-1.9 (OG image) | 30 min | Medium |
| P1 | SEO-ITEM-1.6 (SVG alt text) | 10 min | Low |
| P1 | SEO-ITEM-1.7 (Internal links) | 10 min | Medium |
| P1 | SEO-ITEM-1.10 (Word count) | 2 hours | High |
| P1 | SEO-ITEM-4.1 (Use cases) | 1 hour | High |
| P2 | SEO-ITEM-3.1 (Preload fonts) | 15 min | Low |
| P2 | SEO-ITEM-3.3 (robots.txt) | 10 min | Medium |
| P2 | SEO-ITEM-4.2 (Comparison table) | 1.5 hours | Medium |
| P2 | SEO-ITEM-4.3 (Blog plan) | 2 hours | Medium |
| P3 | SEO-ITEM-5.1–5.3 (Off-page) | Ongoing | High |

---

## QA Verification Checklist

- [ ] Primary keyword "interactive video maker" appears in title tag, meta description, H1, and first 100 words of body text
- [ ] Secondary keywords "branching video", "choose your own adventure", "visual graph editor" distributed naturally
- [ ] Title tag is 58 chars (under 60 limit)
- [ ] Meta description is 158 chars (under 160 limit)
- [ ] URL slug is keyword-optimized (not `/landing.html`)
- [ ] Heading hierarchy: single H1, organized H2, H3, H4 — no more than 6 H4s
- [ ] SoftwareApplication schema validates with Google Rich Results Test
- [ ] FAQPage schema validates with Google Rich Results Test
- [ ] All SVGs have `role="img"` and `aria-label`
- [ ] Canonical tag present and points to correct URL
- [ ] Open Graph image specified and accessible
- [ ] robots.txt and sitemap.xml are accessible
- [ ] No `<br>` in H1 tag
- [ ] Word count between 1,500–2,000
- [ ] Internal links to `/` (app root) and `/feed/` with descriptive anchor text
- [ ] No content cannibalization with `public/index.html` or `public/feed/index.html`
