# Project Plan: Ghost Message

A 100% secure, zero-knowledge, end-to-end encrypted (E2EE) real-time ephemeral chat application. No messages or encryption keys are ever saved to disk or readable by the server.

---

## 1. Security Architecture (Zero-Knowledge)

- **End-to-End Encryption (E2EE):** Standard AES-GCM (256-bit) encryption using the browser's native **Web Crypto API**.
- **Server-Invisible Keys:** The secret encryption key is generated in the browser and stored in the URL's **hash fragment** (e.g., `https://domain.com/room/<roomId>#<secretKey>`). 
  - *Note:* The browser never sends the hash fragment to the server in HTTP requests. Thus, the server only knows the `roomId` and relays ciphertext, but never sees the key to decrypt it.
- **In-Memory Only:** No database, no file storage. The Node.js server purely acts as a WebSocket relay, routing encrypted payloads from sender to recipient in real-time, then discarding them from memory.
- **Anonymity:** No sign-up, email, or telephone number required. Users enter a temporary room-specific nickname which is also fully encrypted before sending.

---

## 2. Tech Stack

- **Frontend:**
  - **Framework:** React (Vite-powered for rapid loading, minimal bundle size, and hot reloading).
  - **Styling:** Vanilla CSS (Custom Design System with CSS custom properties, glassmorphism, cyber-dark aesthetics, and smooth micro-animations).
  - **WebSocket Client:** `socket.io-client`.
- **Backend:**
  - **Runtime & Framework:** Node.js + Express.
  - **WebSocket Server:** `socket.io` (for reliable, event-based real-time communication with automatic reconnection).
- **Deployment:**
  - **Single Service:** Node.js server serves the compiled React app as static files from `/frontend/dist`.
  - **Hosting:** 100% free hosting (Render, Koyeb, Northflank, etc.) with automatic build on push.

---

## 3. Implementation Steps

### Phase 1: Project Setup & Package Configuration
- Initialize root `package.json` for running both frontend and backend concurrently in development.
- Configure backend `package.json` and Express setup.
- Initialize frontend using Vite + React.

### Phase 2: Backend Development (`backend/server.js`)
- Set up an Express server serving public static files.
- Integrate Socket.io.
- Implement room-based real-time event relaying:
  - `join-room`: Adds a socket to a specific `roomId`. Relays a message to others that a peer joined.
  - `send-message`: Relays encrypted message payload (ciphertext, IV, sender info) to all sockets in the room.
  - `typing`: Relays typing state to others in the room.
  - `disconnect`: Tracks users and broadcasts when a user leaves.
- Ensure the server retains **zero data**.

### Phase 3: Cryptography Module (`frontend/src/utils/crypto.js`)
- **Key Generation:** Method to generate a random 256-bit AES key and format it as a URL-safe base64 string.
- **Key Importing:** Method to import the key from the URL hash.
- **Encryption:** Take plaintext message/file data, encrypt it with AES-GCM and a random 12-byte IV, and output base64 strings.
- **Decryption:** Take ciphertext and IV, decrypt it, and return plaintext.

### Phase 4: Frontend UI Design (Vanilla CSS & Responsive Layout)
- Create a beautiful dark cyber-security theme (cyberpunk/glassmorphism) featuring:
  - Deep dark background with subtle grid lines.
  - Glowing accents (neon emerald/mint for security, cyber blue).
  - Smooth custom transitions and micro-animations.
  - Responsive layout (perfectly optimized for iPhones, Androids, tablets, and wide PC monitors).
- Screens to build:
  - **Welcome/Lobby Screen:** One-click "Create Secure Room", instructions explaining the zero-knowledge model, input for nickname.
  - **Chat Interface Screen:**
    - Sidebar/Header: Room link copy button (with animated success feedback), active user indicators.
    - Message Feed: Custom message bubbles, timestamps, status indicators.
    - Chat Input: Message input, image/file attachment button, send button, typing indicator.
    - Encrypted Image/File Viewer: Inline rendering for secure images, and download buttons for secure files.

### Phase 5: Client Socket & E2EE Integration
- Build custom hooks or service layer to connect to the Socket.io server.
- Hook into the crypto module:
  - Before sending a message, encrypt the text and nickname.
  - Upon receiving, decrypt the message. If decryption fails (e.g. wrong key), display a warning instead of contents.
- Implement room join/leave visual cues.
- Build typing indicators.

### Phase 6: Encrypted File & Image Sharing
- Allow selecting files up to 5MB.
- Convert files to ArrayBuffers, encrypt them in the browser, and send them as binary payloads or base64 over Socket.io.
- Decrypt on receipt, create Object URLs, and render images directly or provide file download links.

---

## 4. Hosting & Deployment Requirements

*(Preserved from original requirements)*
- **100% Free Deployment:** Designed to deploy seamlessly to Koyeb or Render free tiers.
- **HTTPS & WebSockets Support:** Handled out of the box by modern hosting providers.
- **One-Command Dev Startup:** `npm run dev` starts both the Express server and Vite React server.
- **Single-Service Build:** Backend serves frontend static files, reducing deployment complexity to a single repo and service.