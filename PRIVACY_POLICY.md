# Privacy Policy

## KeePass Password Manager Chrome Extension

**Last Updated: September 24, 2026**

### Overview

The KeePass Password Manager extension is designed with privacy as the core principle. All data encryption and storage happens entirely on your device.

### Data Collection

The extension does not send vault data to the developer. The leaked-password check is optional and only runs when you choose it:
- No user tracking, analytics, or telemetry
- No crash reporting to remote servers
- No transmission of vault data to the developer

When you submit a password-based sign-in or signup form, the extension may temporarily read the username and password from that form to offer to save them. Pending values stay in page memory, with a short-lived in-memory handoff through the extension's local background process if the page navigates before the prompt can appear. The extension uses them to check for a matching vault record and stores them in the vault only after you choose Save/Update. If the vault is locked or unavailable, the pending values are discarded. Nothing is transmitted to a remote service.

When you choose **Check leaked passwords**, the extension asks for confirmation the first time and sends the first five characters of each distinct saved password's SHA-1 hash to the Have I Been Pwned (HIBP) Pwned Passwords range API. The password and full hash stay on your device; returned hash suffixes are compared locally. HIBP receives the partial-hash requests and normal request metadata such as your IP address. Password checks are not associated with saved usernames or websites. Weak-password checks run locally. See [HIBP's API documentation](https://haveibeenpwned.com/API/v3).

### Data Storage

All your passwords and database information are stored **locally** on your device:

1. **Chrome Storage (chrome.storage.local)**
   - Encrypted KeePass database (.kdbx)
   - Database metadata
   - Non-secret Remember Unlock duration preference
   - Persists across browser restarts

2. **IndexedDB Database**
   - Backup copies of your database
   - Version history (last 5 versions)
   - Automatic snapshots (hourly)
   - Recovery codes
   - Operation journal

3. **Session Storage (chrome.storage.session)**
   - The master password only when you opt into Remember Unlock
   - Cleared on inactivity expiry, manual lock, vault replacement/deletion, or browser exit

### Encryption

- The master password is not stored by default. If you opt into Remember Unlock, it is temporarily stored in browser session storage and is not written to persistent storage.
- Uses PBKDF2 with SHA-256 hashing
- Database blob is encrypted with KeePass format
- Auto-unlock tokens are encrypted with 1-hour expiration

### Permissions

- `storage`: To store encrypted database
- `alarms`: For auto-lock (15 minutes by default, configurable through Remember Unlock) and clipboard auto-clear
- `activeTab`: To fill passwords when you open the extension on a login page
- `scripting`: To fill username/password into the current page (only when you click Fill)
- Website access: To detect password forms, offer to save submitted credentials, and fill matching entries on websites
- `clipboardWrite` (optional, requested when you first copy): To copy passwords

The HIBP range lookup runs only after you choose the leaked-password check and confirm its first-use notice.

### Third-Party Services

The optional leaked-password check uses the Have I Been Pwned Pwned Passwords API. No other third-party services are used.

### Data Deletion

You can delete all data by:
1. Opening extension settings
2. Clicking "Delete Database"
3. All data in chrome.storage.local and IndexedDB is permanently removed

### Open Source

This extension is open source. You can review the code:
- GitHub: https://github.com/Ilya37/keepass-chrome-extension

### Contact

For privacy concerns or questions, open an issue on GitHub.

### Changes to This Policy

We may update this policy. Changes will be reflected here with an updated date.
