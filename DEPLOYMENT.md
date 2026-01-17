# Deployment Guide

## The Problem

**Vercel (and similar static hosting) cannot run Socket.IO servers** because:
- Socket.IO requires persistent WebSocket connections
- Vercel only supports serverless functions (short-lived)
- Your server needs to run continuously

## Solution: Separate Hosting

You need to host the **client** and **server** separately:

1. **Client (Frontend)**: Host on Vercel, Netlify, or GitHub Pages
2. **Server (Backend)**: Host on a platform that supports persistent connections

---

## Step 1: Host the Server

Choose one of these platforms:

### Option A: Railway (Recommended - Easy & Free)

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your `realtime-app` repository
5. Set the root directory to `server`
6. Railway will auto-detect Node.js and deploy
7. Copy your Railway URL (e.g., `https://your-app.railway.app`)

### Option B: Render (Free Tier Available)

1. Go to [render.com](https://render.com)
2. Sign up and create a new "Web Service"
3. Connect your GitHub repo
4. Settings:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Deploy and copy your Render URL

### Option C: Heroku (Requires Credit Card)

1. Install Heroku CLI
2. In the `server` folder:
   ```bash
   heroku create your-app-name
   git push heroku main
   ```

---

## Step 2: Update Client to Use Your Server URL

The client now has a **Server URL input field**. When users visit your Vercel site:

1. They'll see a "Server URL" input field
2. They enter your server URL (e.g., `https://your-app.railway.app`)
3. Click "Connect to Server"
4. Then they can join rooms and start calls

**For localhost**: The client auto-detects and connects automatically.

---

## Step 3: Update Server CORS (If Needed)

If your server is on a different domain, make sure CORS is enabled (already done in `server.js`):

```javascript
const io = new Server(server, {
  cors: {
    origin: '*',  // Allows all origins (for development)
    methods: ['GET', 'POST']
  }
});
```

For production, you might want to restrict to your Vercel domain:

```javascript
origin: ['https://realtime-app-khaki.vercel.app', 'http://localhost:3000']
```

---

## Step 4: Environment Variables (Optional)

If you want to change the port or add other configs:

**Railway/Render**: Add environment variables in their dashboard:
- `PORT=3000` (usually auto-set)

---

## Quick Test

1. Deploy server to Railway/Render
2. Get your server URL
3. Visit your Vercel site
4. Enter server URL in the input field
5. Click "Connect to Server"
6. Join a room and test!

---

## Troubleshooting

### "Connection timeout" or "ERR_TIMED_OUT"
- Make sure your server is actually running
- Check that the server URL is correct (no port needed for HTTPS)
- Verify CORS settings allow your client domain

### "Geolocation error"
- This is normal - geolocation requires HTTPS and user permission
- The app will still work without location

### Server not connecting
- Check server logs on Railway/Render dashboard
- Make sure the server is listening on `0.0.0.0` (already configured)
- Verify the server URL doesn't include a port for HTTPS

---

## Example URLs

- **Client (Vercel)**: `https://realtime-app-khaki.vercel.app`
- **Server (Railway)**: `https://realtime-app-server.railway.app`
- **Users enter**: `https://realtime-app-server.railway.app` in the Server URL field
