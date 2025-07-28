# Cookie Storage Setup (Safe & Secure)

## What This Does
- Stores **session cookies** (like "remember me" tokens)
- Does **NOT** store passwords
- Works like Chrome's "Stay signed in" feature

## How to Enable

1. Create a cookies directory:
```bash
mkdir -p ./browser-data
```

2. Set the environment variable:
```bash
# For local development
export COOKIE_FILE=./browser-data/cookies.json

# Or add to your .env file
COOKIE_FILE=./browser-data/cookies.json
```

3. Start the server normally

## Security Notes
- Cookies are stored in JSON format
- Only contains session tokens (random strings)
- Passwords are NEVER saved
- Delete the file to "log out" of all sites

## How It Works
1. You sign in once (with username/password)
2. Website gives you a session cookie
3. We save that cookie (NOT your password)
4. Next time, the cookie logs you in automatically

## Gmail/OAuth Popups
- OAuth popups (Gmail login) should work automatically
- The popup will appear for login
- Once you sign in, it will close and return to your site
- Your Gmail session will be remembered

## Privacy
- All cookies stay on YOUR server
- Nothing is sent to us
- Delete `cookies.json` anytime to clear all sessions