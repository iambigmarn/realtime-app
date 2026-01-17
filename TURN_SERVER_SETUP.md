# TURN Server Setup Guide

## Why TURN Servers?

TURN (Traversal Using Relays around NAT) servers are needed when:
- Users are behind strict firewalls
- STUN servers can't establish direct peer-to-peer connections
- You see "ICE connection failed" errors
- Video/audio doesn't work between users

**STUN** = Discovers your public IP (works for ~80% of connections)  
**TURN** = Relays traffic when direct connection fails (works for ~100% of connections)

---

## Free TURN Server Options

### Option 1: Metered.ca (Recommended - Free Tier)

1. Go to https://www.metered.ca/tools/openrelay/
2. Click "Get Free TURN Server"
3. Sign up (free, no credit card needed)
4. You'll get:
   - Username
   - Credential (password)
   - Server URLs

5. Add to `main.js`:
```javascript
{
    urls: 'turn:a.relay.metered.ca:80',
    username: 'your-username-here',
    credential: 'your-credential-here'
},
{
    urls: 'turn:a.relay.metered.ca:80?transport=tcp',
    username: 'your-username-here',
    credential: 'your-credential-here'
},
{
    urls: 'turn:a.relay.metered.ca:443',
    username: 'your-username-here',
    credential: 'your-credential-here'
},
{
    urls: 'turn:a.relay.metered.ca:443?transport=tcp',
    username: 'your-username-here',
    credential: 'your-credential-here'
}
```

**Free tier**: 1GB/month bandwidth (good for testing)

---

### Option 2: Twilio (Free Trial)

1. Go to https://www.twilio.com/stun-turn
2. Sign up for free trial
3. Get credentials from Twilio console
4. Add to `main.js`:
```javascript
{
    urls: 'turn:global.turn.twilio.com:3478?transport=udp',
    username: 'your-twilio-username',
    credential: 'your-twilio-credential'
},
{
    urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
    username: 'your-twilio-username',
    credential: 'your-twilio-credential'
}
```

**Free trial**: $15.50 credit (enough for testing)

---

### Option 3: Self-Hosted (coturn)

If you have a VPS/server:

1. Install coturn:
```bash
# Ubuntu/Debian
sudo apt-get install coturn

# macOS
brew install coturn
```

2. Configure `/etc/turnserver.conf`:
```
listening-port=3478
fingerprint
lt-cred-mech
user=username:password
realm=yourdomain.com
```

3. Start coturn:
```bash
sudo systemctl start coturn
```

4. Add to `main.js`:
```javascript
{
    urls: 'turn:your-server-ip:3478',
    username: 'username',
    credential: 'password'
}
```

---

## How to Add TURN Servers

1. Get credentials from one of the options above
2. Open `client/main.js`
3. Find the `ICE_SERVERS` array (around line 12)
4. Uncomment the TURN server examples
5. Replace `your-username` and `your-credential` with your actual credentials
6. Save and redeploy

---

## Testing

After adding TURN servers:

1. Open browser console
2. Look for "ICE connection" logs
3. You should see connections succeed even behind firewalls
4. Video/audio should work between all users

---

## Important Notes

- **Never commit credentials to public repos** - use environment variables or config files that are gitignored
- **Free tiers have limits** - Monitor your usage
- **TURN servers relay traffic** - They use bandwidth, so free tiers are limited
- **For production** - Consider paid TURN services or self-hosted

---

## Quick Start (Metered.ca)

1. Visit: https://www.metered.ca/tools/openrelay/
2. Get free credentials
3. Copy the 4 TURN server configs
4. Paste into `ICE_SERVERS` array in `main.js`
5. Deploy and test!
