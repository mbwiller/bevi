# TextField

Labelled 48pt text field for onboarding, settings and the create-Bev wizard.

- Provide: `label`, `value` or `defaultValue`, optional `prefix` ("@" for handles), `hint`, `error` (replaces the hint, turns the outline `scoreLow`).
- Errors say what to do: "That handle is taken." not "Invalid input".
- **A field never moves while someone types in the form.** A hint that comes and goes with what is typed (the create-Bev wizard's "1 Bev like this is already on Bevi." under Name) gets `reserveHint`: the hint line keeps its 18pt when it is empty, so the fields below stay where they are. Leave it off for a hint that is always there or an error that only shows on submit.
