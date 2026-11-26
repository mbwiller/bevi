# ScreenNotificationsAsk

The ask before the iOS permission prompt: a Sheet over Notifications with the bell, "Hear about it when it happens", one line of what will be sent, a `primary` Button "Turn on notifications" and a ghost "Not now".

- Shown once, the first time Notifications is opened with something in it. Never at launch.
- "Turn on notifications" leads to the iOS prompt. "Not now" closes it, and it does not come back on its own: Settings, Notifications offers it again.
