# Ghost Message 👻

A **100% secure, zero-knowledge, end-to-end encrypted (E2EE)** real-time ephemeral chat application. 

Messages and files are encrypted directly in the user's browser before being transmitted, and the server acts strictly as an in-memory WebSocket relay. Absolutely no message content, file data, metadata, or encryption keys are ever saved to disk or readable by the server.

---

## 🔒 Security & Privacy Architecture

1. **End-to-End Encryption (E2EE):**
   - Built using the browser's native, high-performance **Web Crypto API**.
   - Messages, filenames, file types, and user nicknames are encrypted using **AES-256-GCM** with cryptographically secure random 12-byte Initialization Vectors (IV).

2. **Zero-Knowledge Key Exchange:**
   - The secret encryption key is generated client-side and appended to the URL's **hash fragment** (e.g., `https://domain.com/room/<roomId>#<secretKey>`).
   - **Crucial Security Feature:** Web browsers *never* transmit the hash fragment (anything after the `#`) to the server in HTTP requests. Thus, the server only knows the room exists but can never decrypt the communication.

3. **Pure Ephemeral Memory Relay:**
   - The backend runs a lightweight Express + Socket.io server.
   - It retains **zero databases or persistent disks**. Messages are routed through system RAM and immediately discarded.
   - Closing the browser tab destroys the local chat history forever.

4. **Metadata Isolation:**
   - No phone numbers, emails, accounts, or registrations.
   - User nicknames are encrypted *before* joining the room, making them completely opaque to the server.

---

## 🚀 Key Features

* **Instant Private Channels:** Create a secure room with a single click.
* **Seamless Invocation:** Copy the secure E2EE link and send it via any insecure medium (the decryption key remains private).
* **E2EE File & Image Sharing:** Send files up to 5MB directly through WebSockets. Images render inline inside an encrypted gallery; files can be securely saved to disk.
* **Typing & Presence Indicators:** Real-time feedback of who is online and when they are drafting a response.
* **Premium Theme:** Cyberpunk-inspired dark theme featuring sleek glassmorphism, responsive elements, and smooth micro-animations.

---

## 🛠️ Development Setup

The project is structured as a lightweight monorepo containing a React frontend and Node.js backend:

### 1. Install Dependencies
Run the installer script in the root directory to automatically fetch packages for all components:
```bash
npm run install-all
```
*(Or manually run `npm install` in the root, `backend/`, and `frontend/` directories).*

### 2. Run Locally (Development Mode)
Start the concurrent development servers:
```bash
npm run dev
```
* This launches:
  * **Vite React server** at `http://localhost:5173`
  * **Socket.io Express backend** at `http://localhost:3000`
  * Vite is pre-configured to proxy `/socket.io` websocket events seamlessly.

---

## 🌐 Production & Deployment

To support 100% free hosting and ease of deployment, the application can compile and run as a **single unified service**.

### 1. Build the Frontend
Compile the React app into static files:
```bash
npm run build
```
This generates optimized HTML/JS/CSS assets in `frontend/dist`.

### 2. Run the Production Server
Start the Express server in production mode:
```bash
npm start
```
* Under `NODE_ENV=production`, the Express backend serves the React production build from `frontend/dist` and hosts the Socket.io WebSocket broker under the same port.

### 3. Deploying to Free Clouds (Koyeb / Render)
Deploy this repository directly as a single Web Service.
* **Build Command:** `npm run build`
* **Start Command:** `npm start`
* **Environment Variables:** `NODE_ENV=production`
* **Port:** `3000` (or leave it to auto-detect `$PORT`)
* Automatic SSL/HTTPS is handled by the cloud provider.
