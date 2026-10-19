## Problem Statement

After the editor-chrome Stage, the middle editing surface still feels broken: with an empty Buffer the white editor box sits short above a large gray band; with long unwrapped lines the right side is clipped and there is no usable horizontal scroll. Users also notice that the window scrollbar only moves the middle text area while the title, menus, tabs, Intent/Actions, and status bar stay fixed—and need that behavior confirmed as intentional, not treated as a second bug.

## Solution

Keep **fixed shell chrome** (title / menu / tabs / Intent / Actions / status) and scroll **only** the editor viewport—document that as the product rule. Fix the empty-state fill so the white editor surface occupies the full middle `1fr` band. Keep soft-wrap off for virtual-scroll line height; enable **horizontal scrolling on the same editor viewport** so long lines are reachable; keep the line-number gutter **pinned to the left** while content scrolls horizontally. Do not change Intent, Action, Accept, Find, Recovery, or TitleChrome behavior.

## User Stories

1. As a casual user, I want the title, menu, and tabs to stay put while I scroll the text, so that chrome does not jump away.
2. As a casual user, I want Intent, Actions, and the status bar to stay visible while I scroll the Buffer, so that I can preview and accept without hunting for the bottom panel.
3. As a product owner, I want “only the editor viewport scrolls” documented as expected, so that QA does not file it as a regression.
4. As a casual user, I want an empty Buffer’s white editing surface to fill the middle band of the window, so that the app does not look like a small white card on gray padding.
5. As a casual user, I want that full-height white surface to remain when the Buffer has few lines, so that short documents still look like a real editor.
6. As a Windows user, I want this fill behavior in the desktop shell, so that WebView layout matches the product expectation.
7. As a reader of long lines, I want to scroll horizontally to see the end of a line, so that text is not permanently clipped.
8. As a reader, I want soft wrap to stay off this Stage, so that virtual-scroll row height stays stable.
9. As a reader, I want vertical and horizontal scrolling to share one editor viewport, so that I am not fighting two nested scrollers.
10. As a reader with a line gutter, I want line numbers to stay fixed on the left while I scroll horizontally, so that I never lose row orientation.
11. As a reader, I want line numbers to continue tracking the virtual-scroll window vertically, so that gutter and content stay aligned by line.
12. As a keyboard user, I want existing Ctrl+G / goto-line behavior unchanged, so that jump-to-line still works after layout fixes.
13. As a Find user, I want Find dialog and hit jump behavior unchanged, so that search still reveals matches.
14. As a power user, I want Intent preview / Accept / Reject unchanged, so that the AI loop is not disturbed.
15. As a careful user, I want RecoveryBuffer quit/restore and tab close unchanged, so that data-safety habits remain.
16. As a user on a short window, I want a minimum editor height floor (~16rem), so that the editing surface is not crushed to nothing.
17. As a user on a short window, I accept that the outer window may need to grow or clip chrome rather than destroy the editor floor, so that the editor remains usable.
18. As a caret user on a long line, I accept that this Stage does not auto-follow the caret horizontally, so that scope stays small—I can scroll by hand to the end of the line.
19. As a developer, I want layout contracts at the editor-layout seam (full-height fill + horizontal reach + soft-wrap still off), so that CI catches regressions without screenshots.
20. As a developer, I want VirtualEditor to keep using viewport `scrollTop` for vertical virtualization, so that line windows stay correct.
21. As a developer, I want a gutter pin-left assertion under horizontal scroll, so that numbers do not drift with content.
22. As a developer, I want IntentService Accept / Action / Find / Recovery contracts to stay green, so that viewport work cannot break the moat.
23. As a QA operator, I want a check: empty Buffer → no large gray band under a short white box in the middle band.
24. As a QA operator, I want a check: long unwrapped line → horizontal scroll can reveal characters past the right edge.
25. As a QA operator, I want a check: horizontal scroll → gutter remains at the left edge of the viewport.
26. As a QA operator, I want a check: vertical scroll still only moves editor content, not title or status.
27. As a maintainer, I want soft-wrap to remain explicitly disabled in the layout policy, so that future Stages do not silently reintroduce wrap.
28. As a future Stage owner, I want caret-horizontal-follow deferred, so that it can be added without redoing this layout.
29. As a future Stage owner, I want Intent/Actions collapse deferred, so that this Stage does not expand into chrome redesign.
30. As a product owner, I want no new domain glossary noun for the viewport, so that Buffer/Path language stays clean.

## Implementation Decisions

- **Domain:** No new CONTEXT terms. Layout-only; Path / Buffer / FindBar / RecoveryBuffer / Accept unchanged.
- **Scroll product rule:** Fixed shell chrome; only the editor viewport scrolls (vertical and horizontal). Not a bug.
- **Full-height fill:** The editor viewport’s white surface fills the middle grid `1fr` track. Empty or short Buffers must not leave a large non-editor gray band under a short white card. Keep a ~16rem minimum height floor for very short windows.
- **Soft wrap:** Remains off (virtual-scroll assumes one Buffer line per row height). Long lines use horizontal scrolling instead.
- **Scroll container:** One editor viewport with overflow auto for both axes. Do not introduce a nested horizontal scroller that steals events from vertical virtualization.
- **Gutter:** Remains display-only line numbers; pinned to the left under horizontal scroll; still synced to the virtual-scroll window vertically.
- **Caret horizontal follow:** Out of scope this Stage; manual horizontal scroll is enough.
- **Unchanged:** TitleChrome, menus, Intent panel, Actions panel, status metrics, Find dialog, PathPicker, RecoveryBuffer, ClosePrompter, Accept.
- **Test seam:** Extend the existing editor-layout / viewport-width seam for (1) full-height fill probe, (2) long-line horizontal reach / scrollWidth, (3) soft-wrap still off; plus gutter pin-left under horizontal offset. VirtualEditor vertical `scrollTop` semantics unchanged.
- **Platform:** Windows-first desktop shell; other OS best-effort.

Illustrative layout probes (decision-rich; not a working demo):

```ts
type EditorViewportLayoutProbe = {
  allocatedHeightPx: number; // middle 1fr content box
  viewportClientHeightPx: number;
  viewportScrollWidthPx: number;
  viewportClientWidthPx: number;
  longLineScrollWidthPx: number;
  gutterOffsetLeftPx: number; // after horizontal scroll, should stay ~0 in viewport coords
};

// Full-height fill: viewport client height ≈ allocated 1fr (within tolerance).
// Horizontal reach: longLineScrollWidthPx > viewportClientWidthPx when a long unwrapped line is mounted.
// Soft wrap remains disabled in layout policy.
```

## Testing Decisions

- **Good tests** assert external layout behavior via probes/contracts: middle band filled; long unwrapped line horizontally reachable; soft wrap still off; gutter left offset stable under horizontal scroll; vertical virtualization still driven by viewport scrollTop; Accept/Action/Find/Recovery suites remain green.
- **Do not** require pixel screenshots of Windows scrollbars or N++ skins.
- **Modules under test:** editor-layout (extended), line-gutter pin behavior, VirtualEditor scroll integration (non-regressive).
- **Prior art:** `editor-viewport-width-contract` (WUF-111), line-gutter contracts, virtual-editor / shell chrome contracts.

## Out of Scope

- Soft wrap / reflow that changes virtual-scroll row height model
- Automatic horizontal caret following
- Collapsing or redesigning Intent / Actions panels
- Whole-window scrolling of chrome with content
- TitleChrome / caption button changes
- Encoding/EOL status segments, N++ skin
- New domain glossary entries or ADRs for scroll policy

## Further Notes

- Grill Q1–Q11 on WUF-118 are authoritative for this Stage.
- Disk artifact: `nova/.aidlc/issues/wuf-118-editor-viewport-scroll/` (Multica **WUF-118**).
- Single-ticket delivery on `feature/wuf-118-editor-viewport-scroll` (no Work batch required unless later split).
