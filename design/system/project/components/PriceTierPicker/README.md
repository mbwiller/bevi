# PriceTierPicker

Four tappable "$" cells plus "Not sure, estimate it", for step 2 of the create-Bev wizard.

- Provide: `value` 1–4 or null, `estimated`, `onChange(tier, estimated)`. Choosing "estimate" sends `priceTier: null, priceEstimated: true`.
