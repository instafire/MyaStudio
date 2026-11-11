# SEO KPIs & Monitoring Setup

Code/config only. No external services have been connected, no money spent.
Google Search Console and Google Analytics 4 are named below as the tools
to connect — connecting them is a separate, human-approved step.

## 6.1 KPI definitions

| KPI | Target | Timeframe |
|---|---|---|
| Rank for "interactive video maker" | Top 10 | Within 6 months of launch |
| Rank for "open source interactive video" | Top 5 | Within 3 months |
| Organic CTR, branded queries | > 15% | Ongoing |
| Average dwell time on landing page | > 2 minutes | Ongoing |
| Conversion rate (CTA click → GitHub / app) | > 3% | Ongoing |

### How each KPI is measured
- **Rankings:** Google Search Console, average position per query, checked
  weekly. A rank is "held" when the 4-week rolling average meets the target.
- **CTR:** Search Console, clicks ÷ impressions for branded queries.
- **Dwell time:** GA4 average engagement time on `/interactive-video-maker`.
- **Conversion rate:** GA4 events (see below) — CTA clicks ÷ landing page
  sessions. A "conversion" is a click on any primary CTA (hero start,
  download, open app), not a completed install.

### What success looks like
Top-10 for the primary keyword with a CTR above the branded-query baseline
means the title/description/schema work is paying. If rankings move but CTR
does not, the title and meta description get revised first. If CTR moves but
rankings do not, the next lever is content (the `content-plan.md` cluster)
and backlinks (the `off-page-seo.md` plan).

## 6.2 Monitoring setup

### Google Search Console (to connect)
1. Verify ownership of `myastudio.genznewz.com`.
2. Submit `https://myastudio.genznewz.com/sitemap.xml`.
3. Request indexing for `/interactive-video-maker`.
4. Watch the Performance report weekly for the target keywords:
   `interactive video maker`, `open source interactive video`,
   `branching video software`, `choose your own adventure creator`,
   `how to make interactive videos`.
5. Watch the Enhancements report for FAQ and SoftwareApplication rich
   results once the schema is indexed.

### Google Analytics 4 (to connect)
No GA4 snippet is installed on the page. When it is, wire it to the
`data-track` hooks already on the page — do not add new inline handlers:

| `data-track` value | Element | GA4 event name |
|---|---|---|
| `cta-hero-start` | Hero "Start Creating" button | `cta_click` (`cta_id: hero_start`) |
| `cta-download` | CTA "Download & Start Creating" | `cta_click` (`cta_id: download`) |
| `faq-open` | Each FAQ accordion button | `faq_open` (`question: <button text>`) |
| `carousel-prev` / `carousel-next` | Showcase carousel arrows | `carousel_navigate` (`direction: prev/next`) |

Scroll depth: fire `scroll_depth` at 25/50/75/100% via an
IntersectionObserver on the section boundaries — the page already uses
IntersectionObserver for reveal animations, so the same pattern applies.

### Cadence
- **Weekly:** Search Console positions + CTR for the 5 target keywords;
  GA4 events and engagement time.
- **Monthly:** KPI table above, updated with actuals; one-line verdict per
  KPI (on track / behind / revise target).
- **Quarterly:** re-check the comparison table on the landing page against
  competitors' public pricing/features; re-run the full `npm test` SEO
  suite after any content change.

### Guardrails
- The SEO test suite (`tests/seo-landing.test.js`) runs in `npm test`.
  Any edit that pushes the word count outside 1,500–2,000, breaks the
  single-H1 rule, or desyncs the FAQ schema from the visible FAQ fails
  the build. Fix the page, not the test.
- Never chase a ranking by stuffing the keyword into copy. The keyword
  density check is deliberately absent: natural distribution is the rule.
