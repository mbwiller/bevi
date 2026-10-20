# AvatarPicker

Your own photo where it can be changed: Edit profile and the onboarding profile step. An Avatar 100 (the photo, or your initials) over a `primary` text button, "Add a photo" with no photo and "Change photo" with one, plus "Remove" in `textSecondary`.

- Provide: `name`, `src`, `onChange` (opens the photo picker: on the web the file input, which on an iPhone offers the camera or the library), `onRemove`, `busy` (a spinner over the circle while the picture uploads; both buttons disabled), `error` (a `scoreLow` caption: "Couldn't upload your photo. Try another one.").
- A chosen photo is saved as soon as it uploads, with no Save step: the circle shows the new picture at once and it appears everywhere the person's Avatar does. Removing goes back to initials.
- Photos are resized to 512pt on the longest edge and re-encoded as JPEG before upload (EXIF dropped), the same path as Bev photos at 1600pt.
