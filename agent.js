/**
 * Discord PC Controller - Local PC Agent
 * 
 * Runs on your computer in the background.
 * Connects to your Render Cloud server (or local server) via WebSockets.
 * Listens for /shutdown, /warning, and /stopwarning commands.
 */

const WebSocket = require('ws');
const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const AGENT_CONFIG_FILE = path.join(__dirname, 'agent_config.json');

let config = {
    serverUrl: process.env.SERVER_URL || 'ws://localhost:3000',
    secret: process.env.AGENT_SECRET || 'onyx-secure-pc-secret-67',
    reconnectInterval: 5000
};

if (fs.existsSync(AGENT_CONFIG_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf8'));
        config = { ...config, ...saved };
    } catch (e) {}
}

let ws = null;
let warningProcess = null;

console.log(`\n==================================================`);
console.log(`🖥️  Discord PC Controller - Local Agent Active`);
console.log(`🌐 Target Server: ${config.serverUrl}`);
console.log(`💻 PC Hostname:   ${os.hostname()}`);
console.log(`==================================================\n`);

function connect() {
    console.log(`[${new Date().toLocaleTimeString()}] Connecting to cloud server (${config.serverUrl})...`);
    
    ws = new WebSocket(config.serverUrl);

    ws.on('open', () => {
        console.log(`[${new Date().toLocaleTimeString()}] Connected to server! Registering PC agent...`);
        ws.send(JSON.stringify({
            type: 'AGENT_REGISTER',
            secret: config.secret,
            hostname: os.hostname(),
            platform: `${os.type()} ${os.release()}`
        }));
    });

    ws.on('message', (data) => {
        try {
            const payload = JSON.parse(data);

            if (payload.type === 'REGISTER_OK') {
                console.log(`[${new Date().toLocaleTimeString()}] ✅ Agent Registered Successfully! Waiting for Discord commands...`);
            }

            else if (payload.type === 'REGISTER_FAILED') {
                console.error(`[${new Date().toLocaleTimeString()}] ❌ Registration Failed: ${payload.reason}`);
            }

            else if (payload.type === 'EXECUTE_SHUTDOWN') {
                const seconds = payload.seconds || 10;
                const triggeredBy = payload.triggeredBy || 'Discord User';
                console.log(`\n⚠️ [SHUTDOWN SIGNAL RECEIVED] Triggered by ${triggeredBy}! Timer: ${seconds}s`);

                let cmd = process.platform === 'win32' 
                    ? `shutdown /s /t ${seconds} /c "Remote Shutdown triggered via Discord by ${triggeredBy}"`
                    : `shutdown -h +${Math.ceil(seconds / 60)}`;

                exec(cmd, (err, stdout, stderr) => {
                    if (err) console.error(`Execution error: ${err.message}`);
                    else console.log(`OS Shutdown executed: ${stdout || 'OK'}`);
                });
            }

            else if (payload.type === 'CANCEL_SHUTDOWN') {
                const triggeredBy = payload.triggeredBy || 'Discord User';
                console.log(`\n🛑 [ABORT SIGNAL RECEIVED] Canceled by ${triggeredBy}!`);

                let cancelCmd = process.platform === 'win32' ? 'shutdown /a' : 'shutdown -c';
                exec(cancelCmd, (err, stdout, stderr) => {
                    if (err) console.error(`Failed to cancel shutdown: ${err.message}`);
                    else console.log(`✅ OS Shutdown canceled!`);
                });
            }

            else if (payload.type === 'SHOW_WARNING') {
                const msg = payload.message || 'WARNING: THE PC IS TURNING HOT!';
                const triggeredBy = payload.triggeredBy || 'Discord User';
                console.log(`\n🔥 [GIANT WARNING DISPLAYED] Triggered by ${triggeredBy}: "${msg}"`);

                closeWarningOverlay();

                const warningHtmlPath = path.join(__dirname, 'warning_screen.html');
                const encodedMsg = encodeURIComponent(msg);
                const fileUrl = `file:///${warningHtmlPath.replace(/\\/g, '/')}?msg=${encodedMsg}`;

                if (process.platform === 'win32') {
                    // Launch Edge in app mode & fullscreen
                    warningProcess = spawn('cmd.exe', ['/c', 'start', 'msedge', `--app=${fileUrl}`, '--start-fullscreen'], { detached: true });
                } else {
                    warningProcess = spawn('xdg-open', [fileUrl], { detached: true });
                }
            }

            else if (payload.type === 'STOP_WARNING') {
                console.log(`\n✅ [STOP WARNING SIGNAL RECEIVED] Closing warning overlay screen...`);
                closeWarningOverlay();
            }
        } catch (e) {
            console.error('Message error:', e.message);
        }
    });

    ws.on('close', () => {
        console.log(`[${new Date().toLocaleTimeString()}] Connection lost. Reconnecting in ${config.reconnectInterval / 1000}s...`);
        setTimeout(connect, config.reconnectInterval);
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error: ${err.message}`);
    });
}

function closeWarningOverlay() {
    if (process.platform === 'win32') {
        exec('taskkill /f /im msedge.exe', () => {});
    }
    if (warningProcess) {
        try { warningProcess.kill(); } catch (e) {}
        warningProcess = null;
    }
}

connect();
