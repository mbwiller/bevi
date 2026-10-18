# PriceTier

The price tier as Beli prints it in a meta line: the active count of "$" only, with "~" when Bevi estimated it.

- Provide: `tier` 1–4, `estimated`.
- It inherits the line's size and colour; it reads "about $$, estimated" to screen readers.
- **Never on rows or posts**, estimated or not (D-06): a price on every row was too much information. It shows on Bev detail, the gut-check card and featured cards. The create-Bev wizard picks a tier with `PriceTierPicker`.
