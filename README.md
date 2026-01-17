# Real-time Communication System

A localhost real-time communication system with WebRTC video calls and live location sharing.

## Quick Start

### 1. Install Dependencies (if not already done)

```bash
cd server
npm install
```

### 2. Start the Server

```bash
cd server
node server.js
```

Or use npm:
```bash
cd server
npm start
```

You should see output like:
```
Server running on http://localhost:3000
Server accessible on network at http://192.168.1.100:3000
Socket.IO server ready for connections
```

### 3. Access the Application

#### On the Same Computer (Localhost):
Open your browser and go to:
```
http://localhost:3000
```

**Yes, you need the port number!** The port `:3000` is required.

#### On Another Computer (Same Network):
1. Find your computer's local IP address (shown when server starts, or use `ifconfig` on Mac/Linux)
2. On the other computer's browser, go to:
```
http://YOUR_IP_ADDRESS:3000
```
Example: `http://192.168.1.100:3000`

**Important:** 
- Both computers must be on the same Wi-Fi/network
- You need the port number `:3000`
- Make sure your firewall allows connections on port 3000

## Changing the Port

If you want to use a different port (e.g., 8080):

```bash
PORT=8080 node server.js
```

Then access it at `http://localhost:8080`

## Usage

1. **Join a Room**: Enter a room name (e.g., "room-1") and click "Join Room"
2. **See Users**: View who's already in the room
3. **Start Call**: Click "Start Call" to enable camera/microphone
4. **Share Location**: Your location will automatically appear on the map for others in the room

## Requirements

- Node.js installed
- Modern browser with WebRTC support (Chrome, Firefox, Safari, Edge)
- Camera and microphone permissions
- Google Maps API key (replace `YOUR_API_KEY` in `client/index.html`)

## Troubleshooting

- **Can't access from another computer?** Check firewall settings
- **getUserMedia error?** Make sure you're accessing via `http://` not `file://`
- **Port already in use?** Change the PORT environment variable
