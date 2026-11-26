# PhotoCropper

The step between picking a profile photo and uploading it: the whole screen, "Move and scale" over the photo, with the circle the Avatar will show cut out of a `photoScrim`, then "Use photo" and "Cancel".

- Provide: `src` and the photo's `width` and `height` in pixels (upright, as decoded), `onDone` (gets the framed square in the photo's own pixels: `x`, `y`, `size`), `onCancel`.
- It opens with the photo just filling the circle, centred. Drag to move it, pinch to zoom, up to 4 times (`CROP_MAX_ZOOM`); in this web reference the wheel zooms. A double tap zooms to 2 times, and back to the start. The photo always covers the circle, so there is never an empty edge inside it: it stops at its own edges and cannot be zoomed out past "fills the circle".
- The stage is a full-width square on `input`; the circle is inset by the 16pt gutter and ringed 2pt in `onDeep`. Outside the circle the photo stays visible under the scrim, so it is clear what is being left out.
- With VoiceOver the photo is one adjustable element: swipe up and down to zoom. Moving it needs the drag.
- One `primary` Button, "Use photo", over a `ghost` "Cancel". Cancel uploads nothing and leaves the current photo as it was. After "Use photo" this step closes and the AvatarPicker shows its uploading spinner.
- It comes up over the Edit profile sheet and over the onboarding profile step. Don't use it for Bev photos: a Bev's tile is not a crop of a photo.
