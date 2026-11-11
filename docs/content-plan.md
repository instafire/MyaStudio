# Blog / Tutorial Content Plan — Interactive Video Topic Cluster

Plan only. No articles have been written yet; this document defines what to
write, in what order, and how each piece links back to the landing page
(`/interactive-video-maker`, target keyword: **interactive video maker**).

## Cluster structure

One pillar page (the landing page) + 5 supporting articles. Every article
links back to the landing page with descriptive anchor text, and the landing
page's FAQ / how-to sections link out to the articles once they exist.

## Articles

### 1. "How to Make an Interactive Video: A Beginner's Guide"
- **Intent:** Informational / top-of-funnel
- **Target keywords:** how to make interactive videos, interactive video maker
- **Funnel:** TOFU — first touch for people who have the idea but no tool yet
- **Outline:** what an interactive video is; the 4-part anatomy (scenes,
  choices, variables, endings); shooting scenes for branching; building the
  graph; testing; publishing as standalone HTML
- **Link back:** "built with Mya Studio, a free interactive video maker"
  → `/interactive-video-maker`
- **Priority:** write first — it captures the highest-volume long-tail query
  and feeds every other article.

### 2. "Building a Branching Narrative: Tools and Techniques"
- **Intent:** Informational / MOFU
- **Target keywords:** branching narrative tool, branching video software
- **Funnel:** MOFU — the reader knows the concept and is learning the craft
- **Outline:** linear vs branching story structure; choice design (meaningful
  vs cosmetic choices); state and variables; dead ends and unreachable
  scenes; keeping branch counts manageable; testing a graph
- **Link back:** "Mya Studio's visual graph editor" → `/interactive-video-maker`

### 3. "Mya Studio vs Twine: Which Interactive Story Tool Is Right for You?"
- **Intent:** Commercial investigation
- **Target keywords:** Twine vs interactive video maker, Twine alternative
- **Funnel:** MOFU/BOFU — the reader is comparing tools
- **Outline:** what Twine is good at (text-first stories); what video adds;
  side-by-side table (cost, self-hosting, video, export, analytics);
  when to pick Twine, when to pick Mya Studio
- **Link back:** "Mya Studio (free, open source)" → `/interactive-video-maker`
- **Note:** keep the comparison honest — Twine is the better tool for
  text-only stories; say so.

### 4. "How to Export Interactive Videos to Standalone HTML"
- **Intent:** Transactional / how-to
- **Target keywords:** export interactive video to HTML, interactive video export
- **Funnel:** BOFU — the reader is close to using the tool
- **Outline:** what a standalone player is; export steps in Mya Studio;
  hosting options (GitHub Pages, Netlify, any static host); embedding on a
  landing page; offline playback; updating an exported movie
- **Link back:** "export from Mya Studio" → `/interactive-video-maker`

### 5. "Adding Choice Variables to Your Interactive Video"
- **Intent:** Educational / feature-specific
- **Target keywords:** add choices to video, choice variables interactive video
- **Funnel:** MOFU — the reader already uses (or is evaluating) the tool
- **Outline:** what a choice variable is; set vs require; the locked-door
  pattern (key found in scene 2 opens scene 5); scoring choices for quizzes;
  debugging state in live preview
- **Link back:** "Mya Studio's choice variables" → `/interactive-video-maker`

## Publishing order

1 → 4 → 2 → 5 → 3. The beginner guide and the export how-to capture the
most search demand first; the comparison article goes last, once the
supporting content exists to link to.

## Internal linking rules

- Every article links to the landing page at least once, in the first
  300 words, with the anchor text naming the tool or the keyword — never
  "click here".
- Articles link to each other where the topics overlap (1 ↔ 2, 2 ↔ 5, 4 ↔ 1).
- No article links to the app root (`/`) as its primary CTA; the landing
  page is the conversion target.

## Measurement

Success per article: indexed within 2 weeks, ranking in the top 20 for its
primary keyword within 3 months, and at least one click-through to the
landing page per week once ranked. See `seo-kpis.md`.
