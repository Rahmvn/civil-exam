# UI Visual Direction

## Scope

This document defines the visual direction for FPS Exam Practice using the attached reference image as inspiration only.

This is not a screen implementation document.

This does not:

- implement UI
- edit React components
- change backend logic
- change migrations
- change payment logic

The goal is to give future UI work a clear visual standard that fits the existing product rules, user flows, and mobile-first exam experience.

## Reference Usage Rule

The attached UI reference image should be treated as a style guide, not a layout to duplicate.

We should borrow:

- its calm mobile-first density
- its soft card rhythm
- its restrained graphical progress visuals
- its clean exam-oriented question layout
- its use of green as a serious accent rather than a loud brand gimmick

We should not copy:

- the exact composition
- exact card shapes
- exact iconography
- exact spacing
- exact typography pairings
- exact component hierarchy
- exact CTA placement

The final app should feel like the same category of product quality, but clearly be its own design system.

# 1. Overall Visual Style

The app should feel:

- serious
- official
- calm
- purposeful
- mobile-first
- exam-focused
- trustworthy

The visual language should sit between:

- a government-service digital product
- a clean CBT practice tool
- a light educational utility

It should not feel like:

- a fintech dashboard
- a startup SaaS analytics product
- a content marketplace
- a social feed
- a playful school app

### Core style direction

- Use clean surfaces with generous whitespace.
- Keep pages bright, not dark.
- Make the interface feel structured and competent rather than promotional.
- Let one or two visual anchors carry each screen.
- Use graphic summaries only when they communicate real exam progress.

### Tone in visuals

- Confidence over excitement
- Structure over decoration
- Clarity over novelty
- Quiet polish over visual noise

# 2. Color Direction

## Primary palette direction

The reference image is strongest where it uses deep green, warm white, dark ink text, soft gray borders, and a small gold accent. That general direction fits this product.

Recommended palette family:

- Deep institutional green as primary accent
- Off-white or parchment-white background
- Dark navy-charcoal or ink text
- Cool light gray for borders and dividers
- Muted success green, warning amber, and error red only for states
- Gold accent used sparingly for highlights, not branding overload

## Suggested working palette

- Primary green: `#0F5B3A`
- Deep green surface: `#0C4A31`
- Soft green tint: `#EAF5EF`
- Page background: `#F7F5F0`
- Card background: `#FFFFFF`
- Primary text: `#1C2430`
- Secondary text: `#5D6776`
- Border: `#DCE3E8`
- Success: `#1E8E5A`
- Warning: `#D89A18`
- Error: `#C94747`
- Gold accent: `#D7A928`

These are directional, not final locked tokens.

## Color usage rules

- Green is the main action color.
- Green should not flood every surface.
- White and off-white should do most of the heavy lifting.
- Dark surfaces should be rare and used only for emphasis blocks, such as premium access or high-priority summary cards.
- Error red should be reserved for failed results, destructive actions, and critical warnings.
- Yellow/gold should be used carefully for ring accents, badges, and gentle emphasis only.

## State color rules

- `Available`: green accent, light green tint, or neutral card with green action
- `Passed`: success green with soft tint, never neon
- `Retry available`: amber hint with neutral text, not alarming red
- `Failed with no retry`: muted red emphasis
- `Locked requires payment`: neutral card with green primary unlock CTA
- `Coming soon`: cool gray or pale neutral with low emphasis

# 3. Typography Direction

## Tone

Typography should feel legible, modern, and sober.

The reference uses a geometric sans look that reads well on mobile. We should preserve that clarity, but the product should not depend on a trendy or overly friendly font voice.

## Recommended direction

- Use a clean sans-serif with strong mobile readability.
- Prefer a typeface with slightly humanist warmth rather than a cold enterprise feel.
- Keep headings calm and moderately weighted.
- Avoid overly condensed or high-fashion typography.

## Good fit characteristics

- Clear numerals for scores and timers
- Strong legibility at 12px to 16px
- Good medium and semibold weights
- Calm uppercase or label treatment for badges and section kickers

## Hierarchy rules

- H1: reserved for page title or major result
- H2: section title
- H3: card title or module title
- Body: everyday explanatory copy
- Caption: metadata, timestamps, labels

## Typography behavior

- Use tighter, stronger typography for scores, timers, and batch numbers.
- Use softer text styles for support copy.
- Avoid giant hero headings inside the authenticated app.
- Avoid too many text styles in one screen.

# 4. Card Style

## Overall card language

Cards should feel quiet, airy, and structured.

Recommended card traits:

- Medium corner radius, not oversized
- Thin, soft border
- Very subtle shadow or no shadow at all
- Clear internal spacing
- Strong top-to-bottom reading order

## Card categories

### Summary cards

- Used for access state, module overview, result summary, payment overview
- Can use slightly stronger visual emphasis
- May use tinted or darkened background when deserved

### Utility cards

- Used for batch rows, recent attempts, review entries, profile rows
- Mostly neutral white surfaces
- Emphasis comes from content and status tags, not heavy decoration

### Review cards

- Used for question-by-question answer breakdown
- Slightly denser than dashboard cards
- Keep explanation text readable and uncramped

## Card structure rule

Most cards should follow:

- small label or status
- main title
- one compact summary line
- small data cluster or action row

Avoid overly tall cards that waste vertical space on mobile.

# 5. Button Style

## Primary button

- Solid deep green fill
- White text
- Medium radius
- Clear press state
- Confident but not oversized

Used for:

- Start batch
- Submit test
- Retry batch
- Unlock full access
- Review answers when it is the main next action

## Secondary button

- White or off-white background
- Soft border
- Dark text
- Can carry a faint green border when context supports it

Used for:

- Back to dashboard
- Review
- Previous
- Close
- Explore available modules

## Ghost / text button

- Minimal background
- Used for low-emphasis actions like `Cancel` or small inline navigation

## Button behavior rules

- Keep one obvious primary action per screen.
- Avoid multiple filled buttons competing on one card.
- Buttons should not become huge marketing slabs.
- Destructive actions like sign out should not look like the most important action in the app shell.

# 6. Badge / Status Style

## Badge direction

Badges should be compact, readable, and calm.

Use them for:

- Free Access
- Full Access
- Passed
- Retry Available
- Coming Soon
- Locked
- Recommended Next

## Style rules

- Rounded pill or soft rectangle
- Small type
- Strong contrast but low visual noise
- Color plus text, not color alone

## Status look examples

- `Free Access`: soft green tint with dark green text
- `Full Access`: deeper green badge or dark ink badge with green accent
- `Passed`: pale green tint
- `Retry Available`: warm pale amber
- `Coming Soon`: cool gray or muted slate
- `Locked`: neutral gray with supportive explanatory text nearby

Avoid large badges that look like promotional stickers.

# 7. Navigation Style

## App shell direction

Navigation should feel understated and dependable.

### Header

- Small, calm top bar
- Brand lockup on the left
- Compact utility actions on the right
- No oversized hero banner inside authenticated pages

### Bottom nav

- Persistent on dashboard, modules, review history, and account
- Hidden during active practice, result transition, and payment verification
- Use simple line icons if icons are used at all
- Labels must remain visible, not icon-only

## Active state

- Subtle green underline, pill, or filled-tint treatment
- Do not use loud tabs or oversized floating nav

## Navigation density

- Mobile first
- Short labels
- Clear touch targets
- No visual bulk

# 8. Dashboard Visual Structure

## Screen goal

The dashboard should feel like a composed study home, not a metrics board.

## Recommended visual order

1. Greeting and current state
2. Access card
3. Recommended next action
4. Module list
5. Batch detail inside modules
6. Recent attempts
7. Review shortcut or weak-area section

## Dashboard look

### Greeting block

- Compact headline
- Friendly but professional tone
- Optional small supporting line

### Access card

- Strong visual anchor near the top
- Free users: neutral or soft green card
- Paid users: slightly stronger card, but still restrained
- Should show status and one clear next action

### Module cards

- Use stacked rows rather than giant marketing cards
- Module title, short summary, progress ring or progress bar where real
- Batch summary nested clearly underneath

### Progress visuals

- Use small score rings, slim bars, and lightweight stats
- Avoid big chart blocks before the user has attempt data

### Dashboard rhythm

- The page should alternate between:
  - one summary block
  - one action list
  - one evidence-of-progress block

This keeps the page focused on decision-making.

# 9. Practice Screen Visual Structure

## Screen goal

Practice should feel like the most focused screen in the product.

## Layout direction

- Clean white question surface
- Minimal distractions
- Strong top metadata row
- Question content centered as the visual priority

## Visual sections

### Top bar

- Back action
- Module title
- Batch label
- Timer

### Progress summary

- Question X of N
- Slim progress bar
- Answered / unanswered summary

### Question block

- Large readable question text
- Enough whitespace between question and answers
- No extra analytics or side content

### Answer options

- Simple outlined option cards
- Selected state should be obvious through border, tint, and radio indicator
- Avoid heavy shadows or overly animated toggles

### Bottom action area

- Previous
- Question Map
- Next or Submit

## Practice emphasis rules

- The question itself is the hero, not the chrome around it.
- Timer should be visible but not stressful unless nearing expiry.
- Question-map trigger should feel useful, not dominant.

# 10. Result Screen Visual Structure

## Screen goal

The result screen should create clarity immediately:

- what happened
- how well the user did
- what they should do next

## Visual structure

### Outcome symbol

- Simple pass/fail emblem, ring, or check/cross indicator
- Clean, not celebratory-confetti heavy

### Score block

- Large percentage or score fraction
- Pass mark shown below
- Supporting stats in a neat horizontal cluster or two-row grid

### Next-action block

- One strong primary CTA
- One or two low-emphasis secondary actions

### Tone by result

- Pass: calm positive green treatment
- Retry available: amber-neutral treatment
- Failed with unlock required: stronger but still restrained red emphasis

## Result design rule

- The screen should feel conclusive, not like a dashboard.
- It should be possible to understand the outcome in under 3 seconds.

# 11. Review History / Detail Visual Structure

## Review History

### Goal

- Help users revisit past attempts quickly.

### Structure

- Summary strip at top
- Filter chips or segmented control
- Attempt list cards below
- Optional small insights section

### Attempt card look

- Module and batch
- Score
- Pass/fail badge
- Date
- Primary `Review` action
- Secondary `Retry` or `Next` when relevant

### Density

- Slightly denser than dashboard
- Still comfortable on mobile

## Review Detail

### Goal

- Turn mistakes into understandable learning.

### Structure

- Sticky attempt summary or compact summary card near top
- Question review cards below
- Filter controls for all/wrong/correct/unanswered

### Review card look

- Question number and correctness state
- User answer block
- Correct answer block
- Explanation block
- Reference note block

### Visual correctness language

- Correct: soft green edge or badge
- Wrong: soft red or warm red tint, not aggressive
- Unanswered: cool neutral highlight

## Review detail rule

- Explanation content must look calm and study-oriented, not like error logging.

# 12. Access / Payment Visual Structure

## Screen goal

- Explain value clearly
- Show current access state
- Present payment without hype

## Layout direction

### Top section

- Current status
- Short explanation of free vs full access
- Clear CTA

### Value section

- Real benefits list
- Published modules / batch access
- Unlimited retries
- Review and progress features

### Trust section

- Payment verification note
- Support note
- Paystack trust treatment

## Visual emphasis

- This screen may use one stronger dark green anchor surface if needed
- The page should still feel official, not salesy

## Pricing block

- Price should be easy to find
- Do not surround it with gimmicky urgency or glowing badges

# 13. Graphical Representation Rules

Graphical visuals are allowed where they make progress easier to understand.

## Approved visual types

- Score rings
- Progress bars
- Answered/unanswered dots
- Small line chart for score trend
- Module performance bars
- Compact stat clusters

## Visual usage rules

- Use only real data.
- Keep charts simple and low in count.
- Prefer one good visual over three weak ones.
- Keep graphics secondary to core action.

## Specific rules

### Score rings

- Best for dashboard summary, result score, and review insights
- Use moderate stroke weight
- Avoid thick, flashy rings

### Progress bars

- Best for module completion, review strength areas, and answering progress
- Keep bars slim and clean

### Answered / unanswered dots

- Best for question map
- Use strong state contrast
- Make tap targets large enough for thumbs

### Trend line

- Best for Review Insights only
- Keep it thin, simple, and single-series
- No axis complexity unless necessary

## Avoid

- Donut charts everywhere
- decorative charts without meaning
- stacked analytics panels
- 3D or skeuomorphic visuals
- highly saturated multi-color graphs

# 14. Animation / Microinteraction Rules

## General motion tone

- Quiet
- Short
- Functional
- Polished

## Good motion uses

- Screen fade/slide on route change
- Button press feedback
- Score ring draw
- Progress bar fill
- Question-option selection feedback
- Bottom-sheet entrance and exit

## Motion limits

- Keep timings fast to moderate
- Avoid springy, playful bounce
- Avoid confetti-style celebration
- Avoid motion that delays exam flow

## State-specific motion

- Practice answer selection: subtle tint/border transition
- Submit confirmation: smooth sheet rise
- Result score: ring fill or number count-up
- Review filters: soft crossfade
- Payment verification: calm progress state, not spinning overload

# 15. What To Avoid

## Product-fit problems

- Anything that makes the app feel like a financial wallet or stock dashboard
- Marketplace tiles or content-discovery grids
- Gamified learning tropes
- Cartoon illustrations
- Youthful school-app color energy

## Visual excess

- Heavy gradients
- Glassmorphism
- Large glossy shadows
- Loud neon greens
- Too many colored badges
- Too many filled cards on one screen
- Decorative icon clutter

## Structural mistakes

- Oversized hero sections inside logged-in pages
- Repeated page headings and duplicated summaries
- Dense analytics on the dashboard before attempts exist
- Multiple primary CTAs competing in one region
- Making locked states visually harsher than necessary

## Reference-image elements not to copy directly

- Exact screen compositions
- Exact card placements
- Exact top-bar layouts
- Exact icon set
- Exact result illustrations
- Exact upgrade card design
- Exact question-map arrangement
- Exact chart styling

## Copy and tone mistakes

- Marketing-heavy language
- Hype phrases like premium, elite, success engine, mastery path
- Overly congratulatory language after results
- Fear-based payment nudges
- Grade-level copy that implies content restriction

## Final direction summary

If the reference image gives us a useful north star, it is this:

- bright mobile screens
- structured cards
- restrained green-led identity
- simple progress visuals
- clean exam task focus

The final app should feel more official and product-specific than the reference, with less decorative flourish and more disciplined information hierarchy.
