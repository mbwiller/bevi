# SegmentedTabs

Underline tabs with an animated 3pt bar.

- `underline-text` (Lists: Bev'd · Want to Try · For you · Top; the Feed: Your feed · Explore): 20pt labels that scroll sideways, bar in `text`.
- `underline-icon` (Profile: Activity · Taste Profile): equal halves, icon + 17pt label, with `accent="text"`; `accent="primary"` stays available for a grape bar.
- Provide: `tabs` ([{ id, label, icon? }]), `value`, `onChange`.
- "For you" is only the tab's label, so four fit across a phone. The list keeps its name, Recommended for you, wherever it is written out.
