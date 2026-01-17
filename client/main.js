// ============================================================================
// Real-time Communication Client
// Handles WebRTC peer connections, Socket.IO signaling, and Google Maps
// ============================================================================

// Configuration
// Server URL - will be set by user via UI or auto-detected for localhost
let SERVER_URL = '';

let ROOM_ID = null; // Will be set when user joins a room
const STUN_SERVER = { urls: 'stun:stun.l.google.com:19302' };

// Global state
let socket = null;
let localStream = null;
let peerConnections = new Map(); // Map<userId, RTCPeerConnection>
let remoteVideos = new Map(); // Map<userId, {videoElement, wrapperElement}>
let map = null;
let userMarkers = new Map(); // Map<userId, google.maps.Marker>
let watchPositionId = null;
let currentRoomUsers = new Set(); // Track users in current room
let isInRoom = false;

// DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideosContainer = document.getElementById('remoteVideosContainer');
const startCallBtn = document.getElementById('startCallBtn');
const statusDiv = document.getElementById('status');
const serverUrlInput = document.getElementById('serverUrlInput');
const connectServerBtn = document.getElementById('connectServerBtn');
const roomInput = document.getElementById('roomInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const currentRoomDiv = document.getElementById('currentRoom');
const usersListDiv = document.getElementById('usersList');
const usersListItems = document.getElementById('usersListItems');

// ============================================================================
// Socket.IO Connection & Event Handlers
// ============================================================================

function initializeSocket() {
    if (!SERVER_URL) {
        updateStatus('ERROR: Server URL not configured. Please update SERVER_URL in main.js', 'error');
        console.error('SERVER_URL is not set. Please configure your server URL in main.js');
        return;
    }
    
    socket = io(SERVER_URL);

    socket.on('connect', () => {
        updateStatus('Connected to server', 'success');
        console.log('Socket.IO connected:', socket.id);
        // Don't auto-join room - wait for user to specify room name
    });

    socket.on('disconnect', () => {
        updateStatus('Disconnected from server', 'error');
        console.log('Socket.IO disconnected');
    });

    // Receive room state when joining (existing users and their locations)
    socket.on('room-state', async (data) => {
        console.log('Room state received:', data);
        const { users, locations } = data;

        // Update users list
        currentRoomUsers.clear();
        users.forEach(userId => currentRoomUsers.add(userId));
        currentRoomUsers.add(socket.id); // Add self
        updateUsersList();

        // Create peer connections with all existing users (excluding ourselves)
        if (users.length > 0 && localStream) {
            for (const userId of users) {
                // Don't create connection with ourselves
                if (userId !== socket.id) {
                    await createPeerConnection(userId);
                    await createOffer(userId);
                }
            }
        }

        // Add markers for existing users' locations
        locations.forEach(({ userId, lat, lng }) => {
            addOrUpdateUserMarker(userId, lat, lng);
        });
    });

    // Handle new user joining
    socket.on('user-joined', async ({ userId }) => {
        console.log('User joined:', userId);
        updateStatus(`User ${userId.substring(0, 8)} joined the room`, 'success');

        // Add to users list
        currentRoomUsers.add(userId);
        updateUsersList();

        // Create peer connection with the new user (if not ourselves)
        // Only if we already have local stream (camera started)
        // If we don't have local stream yet, we'll create connection when we start camera
        if (localStream && userId !== socket.id) {
            await createPeerConnection(userId);
            await createOffer(userId);
        }
    });

    // Handle user leaving
    socket.on('user-left', ({ userId }) => {
        console.log('User left:', userId);
        updateStatus(`User ${userId.substring(0, 8)} left the room`, 'error');

        // Remove from users list
        currentRoomUsers.delete(userId);
        updateUsersList();

        // Remove marker for this user
        removeUserMarker(userId);

        // Close and remove peer connection
        const peerConnection = peerConnections.get(userId);
        if (peerConnection) {
            peerConnection.close();
            peerConnections.delete(userId);
        }

        // Remove video element
        removeRemoteVideo(userId);
    });

    // Handle WebRTC signaling messages
    socket.on('webrtc-signal', async (data) => {
        const { from, signal } = data;
        console.log('Received WebRTC signal from', from, signal.type);

        // Get or create peer connection for this specific user
        let peerConnection = peerConnections.get(from);
        if (!peerConnection && localStream) {
            await createPeerConnection(from);
            peerConnection = peerConnections.get(from);
        }

        if (!peerConnection) {
            console.warn('No peer connection available for', from);
            return;
        }

        try {
            if (signal.type === 'offer') {
                // Check if we already have a local description (we sent an offer)
                // If so, this is a simultaneous offer - we should handle it as a rollback
                if (peerConnection.localDescription && peerConnection.localDescription.type === 'offer') {
                    console.log('Simultaneous offer detected, setting remote description...');
                }
                
                // Set remote description and create answer
                await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                // Send answer back to the specific user
                socket.emit('webrtc-signal', {
                    roomId: ROOM_ID,
                    from: socket.id,
                    to: from,
                    signal: answer
                });
                
                console.log('Answer created and sent to', from);
            } else if (signal.type === 'answer') {
                // Set remote description (answer)
                const remoteDesc = new RTCSessionDescription(signal);
                await peerConnection.setRemoteDescription(remoteDesc);
                console.log('Answer received and set for', from);
            } else if (signal.type === 'candidate') {
                // Add ICE candidate (can be added even before remote description is set)
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    console.log('ICE candidate added for', from);
                } catch (error) {
                    // If remote description isn't set yet, queue the candidate
                    console.log('Queueing ICE candidate for', from, '(remote description not ready)');
                    // The candidate will be processed when remote description is set
                }
            }
        } catch (error) {
            console.error('Error handling WebRTC signal:', error);
            updateStatus('Error handling WebRTC signal: ' + error.message, 'error');
        }
    });

    // Handle location updates from other users
    socket.on('location-update', ({ userId, lat, lng }) => {
        console.log(`Location update from ${userId}:`, lat, lng);
        addOrUpdateUserMarker(userId, lat, lng);
    });
}

// ============================================================================
// WebRTC Peer Connection Setup
// ============================================================================

// Create a peer connection for a specific user
async function createPeerConnection(userId) {
    // Safety check: Never create connection with ourselves
    if (userId === socket.id) {
        console.warn('Attempted to create peer connection with self - ignoring');
        return;
    }
    
    // Don't create duplicate connections
    if (peerConnections.has(userId)) {
        console.log('Peer connection already exists for', userId);
        return;
    }

    // Create RTCPeerConnection with STUN server
    const peerConnection = new RTCPeerConnection({
        iceServers: [STUN_SERVER]
    });

    // Add local stream tracks to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle remote stream - create video element for this specific user
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream from', userId);
        
        // Safety check: Don't show our own video as a remote video
        if (userId === socket.id) {
            console.warn('Ignoring own stream as remote video');
            return;
        }
        
        const remoteStream = event.streams[0];
        addRemoteVideo(userId, remoteStream);
        updateStatus(`Video from ${userId.substring(0, 8)} connected`, 'success');
    };

    // Handle ICE candidates - send to specific user
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-signal', {
                roomId: ROOM_ID,
                from: socket.id,
                to: userId,
                signal: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            });
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log(`Peer connection with ${userId.substring(0, 8)}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            updateStatus(`Connected to ${userId.substring(0, 8)}`, 'success');
        } else if (peerConnection.connectionState === 'failed') {
            console.error(`Connection failed with ${userId.substring(0, 8)}`);
            updateStatus(`Connection failed with ${userId.substring(0, 8)}`, 'error');
        }
    };

    // Handle ICE connection state
    peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection with ${userId.substring(0, 8)}:`, peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            console.error(`ICE connection failed with ${userId.substring(0, 8)}`);
            // Try to restart ICE
            peerConnection.restartIce();
        }
    };

    // Store the peer connection
    peerConnections.set(userId, peerConnection);
}

// Create and send offer to a specific user
async function createOffer(userId) {
    const peerConnection = peerConnections.get(userId);
    if (!peerConnection || !localStream) {
        console.warn('Cannot create offer: peer connection or local stream not ready for', userId);
        return;
    }

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Send offer to specific user
        socket.emit('webrtc-signal', {
            roomId: ROOM_ID,
            from: socket.id,
            to: userId,
            signal: offer
        });

        console.log('Offer created and sent to', userId);
    } catch (error) {
        console.error('Error creating offer:', error);
        updateStatus('Error creating offer', 'error');
    }
}

// Add remote video element for a user
function addRemoteVideo(userId, stream) {
    // Safety check: Never show our own video as a remote video
    if (userId === socket.id) {
        console.warn('Attempted to add own video as remote - ignoring');
        return;
    }
    
    // Remove existing video if any
    removeRemoteVideo(userId);

    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.className = 'remote-video-wrapper';
    wrapper.id = `remote-video-${userId}`;

    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `User ${userId.substring(0, 8)}`;

    wrapper.appendChild(label);
    wrapper.appendChild(video);
    remoteVideosContainer.appendChild(wrapper);

    // Store references
    remoteVideos.set(userId, { videoElement: video, wrapperElement: wrapper });
}

// Remove remote video element for a user
function removeRemoteVideo(userId) {
    const videoData = remoteVideos.get(userId);
    if (videoData) {
        // Stop the video stream
        if (videoData.videoElement.srcObject) {
            videoData.videoElement.srcObject.getTracks().forEach(track => track.stop());
        }
        // Remove from DOM
        videoData.wrapperElement.remove();
        remoteVideos.delete(userId);
    }
}

// ============================================================================
// Media Stream (Camera/Microphone)
// ============================================================================

async function startLocalStream() {
    try {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            // Fallback for older browsers
            const getUserMedia = navigator.mediaDevices?.getUserMedia ||
                                 navigator.getUserMedia ||
                                 navigator.webkitGetUserMedia ||
                                 navigator.mozGetUserMedia ||
                                 navigator.msGetUserMedia;

            if (!getUserMedia) {
                throw new Error('getUserMedia is not supported in this browser');
            }

            // Check if page is served over HTTP/HTTPS (required for getUserMedia)
            if (window.location.protocol === 'file:') {
                throw new Error('Page must be served over HTTP/HTTPS. Please access via http://localhost:3000');
            }

            // Use fallback API (returns a Promise in modern browsers, callback in old ones)
            return new Promise((resolve, reject) => {
                getUserMedia.call(navigator, {
                    video: true,
                    audio: true
                }, (stream) => {
                    localStream = stream;
                    localVideo.srcObject = localStream;
                    updateStatus('Camera and microphone enabled', 'success');
                    resolve(true);
                }, (error) => {
                    reject(error);
                });
            });
        }

        // Request user media (modern API)
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        // Display local video
        localVideo.srcObject = localStream;
        updateStatus('Camera and microphone enabled', 'success');

        // Now that we have local stream, create peer connections with all existing users
        if (isInRoom && currentRoomUsers.size > 1) {
            // Get all other users (excluding ourselves)
            const otherUsers = Array.from(currentRoomUsers).filter(id => id !== socket.id);
            for (const userId of otherUsers) {
                try {
                    await createPeerConnection(userId);
                    await createOffer(userId);
                } catch (error) {
                    console.error('Error creating connection with', userId, error);
                }
            }
        }

        return true;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        
        let errorMessage = error.message;
        if (!navigator.mediaDevices) {
            errorMessage = 'MediaDevices API not available. Make sure you access the page via http://localhost:3000 (not file://)';
        } else if (window.location.protocol === 'file:') {
            errorMessage = 'Page must be served over HTTP/HTTPS. Please access via http://localhost:3000';
        }
        
        updateStatus('Error accessing camera/microphone: ' + errorMessage, 'error');
        return false;
    }
}

// ============================================================================
// Google Maps Integration
// ============================================================================

// Initialize Google Map (called by Google Maps API callback)
window.initMap = function() {
    // Default center (can be user's location or a default)
    const defaultCenter = { lat: 37.7749, lng: -122.4194 }; // San Francisco

    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 15,
        center: defaultCenter,
        mapTypeId: 'roadmap'
    });

    console.log('Google Map initialized');

    // Start watching user's position
    startLocationTracking();
};

// Start tracking user's location
function startLocationTracking() {
    if (!navigator.geolocation) {
        updateStatus('Geolocation not supported by browser', 'error');
        return;
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    };

    watchPositionId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude: lat, longitude: lng } = position.coords;
            console.log('Current location:', lat, lng);

            // Update map center to user's location (first time)
            if (map && !userMarkers.has('self')) {
                map.setCenter({ lat, lng });
                addOrUpdateUserMarker('self', lat, lng, true); // true = is self
            } else if (userMarkers.has('self')) {
                addOrUpdateUserMarker('self', lat, lng, true);
            }

            // Emit location update to server (only if in a room)
            if (socket && socket.connected && isInRoom && ROOM_ID) {
                socket.emit('location-update', {
                    roomId: ROOM_ID,
                    lat,
                    lng
                });
            }
        },
        (error) => {
            console.error('Geolocation error:', error);
            updateStatus('Error getting location: ' + error.message, 'error');
        },
        options
    );
}

// Add or update marker for a user
function addOrUpdateUserMarker(userId, lat, lng, isSelf = false) {
    if (!map) return;

    const marker = userMarkers.get(userId);

    if (marker) {
        // Update existing marker position smoothly
        marker.setPosition({ lat, lng });
    } else {
        // Create new marker
        const newMarker = new google.maps.Marker({
            position: { lat, lng },
            map: map,
            title: isSelf ? 'You' : `User ${userId.substring(0, 8)}`,
            icon: isSelf ? {
                url: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
            } : {
                url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
            },
            animation: google.maps.Animation.DROP
        });

        userMarkers.set(userId, newMarker);
    }
}

// Remove marker for a user
function removeUserMarker(userId) {
    const marker = userMarkers.get(userId);
    if (marker) {
        marker.setMap(null);
        userMarkers.delete(userId);
    }
}

// ============================================================================
// Room Management
// ============================================================================

function joinRoom(roomName) {
    if (!socket || !socket.connected) {
        updateStatus('Not connected to server', 'error');
        return;
    }

    if (!roomName || roomName.trim() === '') {
        updateStatus('Please enter a room name', 'error');
        return;
    }

    const trimmedRoomName = roomName.trim();
    
    // Leave previous room if any
    if (isInRoom && ROOM_ID) {
        // Clean up existing connections
        peerConnections.forEach((pc, userId) => {
            pc.close();
        });
        peerConnections.clear();
        remoteVideos.forEach((videoData, userId) => {
            removeRemoteVideo(userId);
        });
        currentRoomUsers.clear();
    }

    ROOM_ID = trimmedRoomName;
    isInRoom = true;

    // Join the room
    socket.emit('join-room', ROOM_ID);
    updateStatus(`Joining room: ${ROOM_ID}...`, 'success');
    
    // Update UI
    currentRoomDiv.textContent = `Current Room: ${ROOM_ID}`;
    currentRoomDiv.style.display = 'block';
    usersListDiv.style.display = 'block';
    roomInput.disabled = true;
    joinRoomBtn.disabled = true;
    startCallBtn.disabled = false;
}

function updateUsersList() {
    usersListItems.innerHTML = '';
    
    currentRoomUsers.forEach(userId => {
        const li = document.createElement('li');
        if (userId === socket.id) {
            li.className = 'self';
            li.innerHTML = '<span class="user-indicator"></span> You (me)';
        } else {
            li.innerHTML = `<span class="user-indicator"></span> User ${userId.substring(0, 8)}`;
        }
        usersListItems.appendChild(li);
    });
}

// ============================================================================
// UI Event Handlers
// ============================================================================

// Connect to server
connectServerBtn.addEventListener('click', () => {
    const serverUrl = serverUrlInput.value.trim();
    if (!serverUrl) {
        updateStatus('Please enter a server URL', 'error');
        return;
    }
    
    // Validate URL format
    try {
        new URL(serverUrl);
    } catch (e) {
        updateStatus('Invalid server URL format. Use http:// or https://', 'error');
        return;
    }
    
    SERVER_URL = serverUrl;
    updateStatus('Connecting to server...', 'success');
    
    // Initialize socket connection
    if (socket) {
        socket.disconnect();
    }
    initializeSocket();
    
    // Enable room input
    roomInput.disabled = false;
    joinRoomBtn.disabled = false;
    connectServerBtn.disabled = true;
    serverUrlInput.disabled = true;
});

serverUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        connectServerBtn.click();
    }
});

joinRoomBtn.addEventListener('click', () => {
    const roomName = roomInput.value.trim();
    joinRoom(roomName);
});

roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinRoom(roomInput.value);
    }
});

startCallBtn.addEventListener('click', async () => {
    if (!isInRoom) {
        updateStatus('Please join a room first', 'error');
        return;
    }

    startCallBtn.disabled = true;
    updateStatus('Starting call...', 'success');

    const success = await startLocalStream();
    if (success) {
        startCallBtn.textContent = 'Call Active';
    } else {
        startCallBtn.disabled = false;
    }
});

// Update status message
function updateStatus(message, type = '') {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
}

// ============================================================================
// Initialize Application
// ============================================================================

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Check if page is served over HTTP/HTTPS (required for getUserMedia and WebRTC)
    if (window.location.protocol === 'file:') {
        updateStatus('ERROR: Page must be served over HTTP. Please access via http://localhost:3000', 'error');
        startCallBtn.disabled = true;
        console.error('Page accessed via file:// protocol. getUserMedia requires HTTP/HTTPS.');
        return;
    }

    // Check if getUserMedia is available
    if (!navigator.mediaDevices && !navigator.getUserMedia && !navigator.webkitGetUserMedia) {
        updateStatus('ERROR: Browser does not support getUserMedia', 'error');
        startCallBtn.disabled = true;
        console.error('getUserMedia not supported');
        return;
    }

    // Auto-detect server URL for localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        SERVER_URL = `${window.location.protocol}//${window.location.hostname}:${window.location.port || 3000}`;
        serverUrlInput.value = SERVER_URL;
        // Auto-connect for localhost
        initializeSocket();
        roomInput.disabled = false;
        joinRoomBtn.disabled = false;
        connectServerBtn.disabled = true;
        serverUrlInput.disabled = true;
        updateStatus('Connected to localhost server', 'success');
    } else {
        // For production, user must enter server URL
        updateStatus('Enter your server URL and click "Connect to Server"', 'success');
        serverUrlInput.placeholder = 'e.g., https://your-server.railway.app';
    }
});
