document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const botStatusBadge = document.getElementById('botStatusBadge');
    const botStatusText = document.getElementById('botStatusText');
    const botTagText = document.getElementById('botTagText');
    const hostnameText = document.getElementById('hostnameText');
    const specHost = document.getElementById('specHost');
    const specOS = document.getElementById('specOS');
    const specUptime = document.getElementById('specUptime');
    const specRAM = document.getElementById('specRAM');

    const configForm = document.getElementById('configForm');
    const botTokenInput = document.getElementById('botToken');
    const clientIdInput = document.getElementById('clientId');
    const guildIdInput = document.getElementById('guildId');
    const toggleTokenBtn = document.getElementById('toggleTokenBtn');

    const startBotBtn = document.getElementById('startBotBtn');
    const stopBotBtn = document.getElementById('stopBotBtn');
    const triggerShutdownBtn = document.getElementById('triggerShutdownBtn');
    const triggerCancelBtn = document.getElementById('triggerCancelBtn');
    const delayInput = document.getElementById('delayInput');

    const shutdownBanner = document.getElementById('shutdownBanner');
    const countdownSecs = document.getElementById('countdownSecs');
    const cancelShutdownBannerBtn = document.getElementById('cancelShutdownBannerBtn');

    const terminalLogs = document.getElementById('terminalLogs');
    const clearLogsBtn = document.getElementById('clearLogsBtn');

    // Password visibility toggle
    toggleTokenBtn.addEventListener('click', () => {
        const isPass = botTokenInput.type === 'password';
        botTokenInput.type = isPass ? 'text' : 'password';
        toggleTokenBtn.textContent = isPass ? '🙈' : '👁️';
    });

    // Load initial config
    fetch('/api/config')
        .then(res => res.json())
        .then(cfg => {
            if (cfg.rawToken) botTokenInput.value = cfg.rawToken;
            if (cfg.clientId) clientIdInput.value = cfg.clientId;
            if (cfg.guildId) guildIdInput.value = cfg.guildId;
            if (cfg.shutdownDelay) delayInput.value = cfg.shutdownDelay;
        })
        .catch(console.error);

    // Form Submit
    configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const body = {
            token: botTokenInput.value.trim(),
            clientId: clientIdInput.value.trim(),
            guildId: guildIdInput.value.trim(),
            shutdownDelay: parseInt(delayInput.value) || 10
        };

        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(res => res.json())
        .then(data => {
            appendLog({ timestamp: new Date().toLocaleTimeString(), msg: data.message, type: 'success' });
        })
        .catch(err => {
            appendLog({ timestamp: new Date().toLocaleTimeString(), msg: err.message, type: 'error' });
        });
    });

    // Bot Start/Stop
    startBotBtn.addEventListener('click', () => {
        fetch('/api/bot/start', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                appendLog({ timestamp: new Date().toLocaleTimeString(), msg: `Start command sent. Status: ${data.botStatus}`, type: 'info' });
            });
    });

    stopBotBtn.addEventListener('click', () => {
        fetch('/api/bot/stop', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                appendLog({ timestamp: new Date().toLocaleTimeString(), msg: `Stop command sent. Status: ${data.botStatus}`, type: 'info' });
            });
    });

    // Trigger Shutdown
    triggerShutdownBtn.addEventListener('click', () => {
        const secs = parseInt(delayInput.value) || 10;
        if (!confirm(`Are you sure you want to trigger PC shutdown in ${secs} seconds?`)) return;

        fetch('/api/shutdown/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seconds: secs })
        })
        .then(res => res.json())
        .then(data => {
            appendLog({ timestamp: new Date().toLocaleTimeString(), msg: data.message, type: data.success ? 'warn' : 'error' });
        });
    });

    // Abort Shutdown
    const cancelShutdown = () => {
        fetch('/api/shutdown/cancel', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                appendLog({ timestamp: new Date().toLocaleTimeString(), msg: data.message, type: 'success' });
            });
    };

    triggerCancelBtn.addEventListener('click', cancelShutdown);
    cancelShutdownBannerBtn.addEventListener('click', cancelShutdown);

    // Clear Terminal Logs
    clearLogsBtn.addEventListener('click', () => {
        terminalLogs.innerHTML = '';
    });

    // Append log line helper
    function appendLog(logObj) {
        const line = document.createElement('div');
        line.className = `log-line log-${logObj.type || 'info'}`;
        line.innerHTML = `<span class="log-ts">[${logObj.timestamp}]</span> <span class="log-text">${escapeHtml(logObj.msg)}</span>`;
        terminalLogs.appendChild(line);
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // Update UI State from Server Payload
    function updateUIState(state) {
        // Bot Status Badge
        botStatusBadge.className = 'status-badge';
        if (state.botStatus === 'ONLINE') {
            botStatusBadge.classList.add('status-online');
            botStatusText.textContent = 'BOT ONLINE';
        } else if (state.botStatus === 'CONNECTING') {
            botStatusBadge.classList.add('status-connecting');
            botStatusText.textContent = 'CONNECTING...';
        } else if (state.botStatus === 'ERROR') {
            botStatusBadge.classList.add('status-danger');
            botStatusText.textContent = 'BOT ERROR';
        } else {
            botStatusBadge.classList.add('status-offline');
            botStatusText.textContent = 'BOT OFFLINE';
        }

        botTagText.textContent = state.botTag ? `@${state.botTag}` : 'Not Connected';
        hostnameText.textContent = `${state.hostname} ONLINE`;

        // Specs
        specHost.textContent = state.hostname;
        specOS.textContent = `${state.platform}`;
        
        const hours = Math.floor(state.uptime / 3600);
        const mins = Math.floor((state.uptime % 3600) / 60);
        specUptime.textContent = `${hours}h ${mins}m`;

        const freeGB = (state.freeMem / (1024 * 1024 * 1024)).toFixed(1);
        const totalGB = (state.totalMem / (1024 * 1024 * 1024)).toFixed(1);
        specRAM.textContent = `${freeGB} GB / ${totalGB} GB`;

        // Shutdown Countdown Banner
        if (state.shutdownTimeRemaining > 0) {
            shutdownBanner.classList.remove('hidden');
            countdownSecs.textContent = state.shutdownTimeRemaining;
        } else {
            shutdownBanner.classList.add('hidden');
        }
    }

    // WebSocket Realtime connection
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            appendLog({ timestamp: new Date().toLocaleTimeString(), msg: 'Connected to server WebSocket stream.', type: 'success' });
        };

        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'init') {
                    updateUIState(payload.data.state);
                    if (Array.isArray(payload.data.logs)) {
                        terminalLogs.innerHTML = '';
                        payload.data.logs.forEach(appendLog);
                    }
                } else if (payload.type === 'state') {
                    updateUIState(payload.data);
                } else if (payload.type === 'log') {
                    appendLog(payload.data);
                }
            } catch (e) {
                console.error(e);
            }
        };

        ws.onclose = () => {
            appendLog({ timestamp: new Date().toLocaleTimeString(), msg: 'WebSocket disconnected. Reconnecting in 3s...', type: 'warn' });
            setTimeout(connectWebSocket, 3000);
        };
    }

    connectWebSocket();
});
