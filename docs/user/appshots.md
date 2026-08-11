# Appshots

Appshots capture the frontmost macOS window and attach it to the active T3 Code task. Configure
the global shortcut in **Settings** → **Appshots**. Screen Recording permission is required for
the image, and Accessibility permission supplies interface text, including content outside the
visible scroll area. You can also choose **Take Appshot** from the composer's Add menu.

The default global shortcut is a quick double-press of the Option key. You can replace it with a
standard key combination in Settings.

The task's runtime mode controls capture behavior:

- **Supervised** asks before reading or capturing the target window.
- **Auto**, **Auto-accept edits**, and **Full access** capture immediately.

Every mode captures the complete image and all interface text macOS makes available. Appshots do
not parse or redact passwords or other secrets, so review the animated preview before sending it.
Removing the preview removes the Appshot from the draft.

Appshots are captured by the macOS desktop shell. Once attached, they travel through
the same image-attachment path as pasted images, so the resulting task remains available from web
and mobile clients.
