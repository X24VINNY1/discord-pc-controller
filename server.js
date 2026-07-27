const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    EmbedBuilder 
} = require('discord.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables (Render supported)
let config = {
    token: process.env.DISCORD_TOKEN || '',
    clientId: process.env.CLIENT_ID || '',
    guildId: process.env.GUILD_ID || '',
    agentSecret: process.env.AGENT_SECRET || 'onyx-secure-pc-secret-67',
    shutdownDelay: 10
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        config = { ...config, ...savedConfig };
    } catch (e) {
        console.error('Failed to read config file:', e.message);
    }
}

function saveConfig(newConfig) {
    config = { ...config, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Log broadcast helper
const logs = [];
function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logObj = { timestamp, msg, type };
    logs.push(logObj);
    if (logs.length > 200) logs.shift();

    const payload = JSON.stringify({ type: 'log', data: logObj });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${msg}`);
}

// Connected Local Agents Tracking
const connectedAgents = new Map();

function broadcastState() {
    const state = getSystemStatus();
    const payload = JSON.stringify({ type: 'state', data: state });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isUI) {
            client.send(payload);
        }
    });
}

// Discord Client State
let client = null;
let botStatus = 'OFFLINE';
let activeShutdownTimer = null;
let activeShutdownSeconds = 0;
let countdownInterval = null;
let activeWarningState = false;

// Slash Commands Definition
const commands = [
    new SlashCommandBuilder()
        .setName('shutdown')
        .setDescription('Remotely shuts down your computer via local PC agent')
        .addIntegerOption(opt => 
            opt.setName('seconds')
               .setDescription('Countdown delay in seconds (Default: 10s)')
               .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('Cancels an ongoing PC shutdown timer'),
    new SlashCommandBuilder()
        .setName('warning')
        .setDescription('Displays a giant flashing warning overlay on your PC screen!')
        .addStringOption(opt =>
            opt.setName('message')
               .setDescription('Custom warning message text (Optional)')
               .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('stopwarning')
        .setDescription('Stops and closes the PC screen warning overlay'),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('View connected PC agent status and bot metrics'),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check Discord bot latency')
].map(cmd => cmd.toJSON());

// Register Slash Commands
async function registerSlashCommands(token, clientId, guildId) {
    try {
        log('Registering Slash Commands with Discord API...', 'info');
        const rest = new REST({ version: '10' }).setToken(token);
        
        if (guildId && guildId.trim() !== '') {
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands }
            );
            log(`Slash commands registered instantly for Guild: ${guildId}`, 'success');
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );
            log('Slash commands registered globally across all servers.', 'success');
        }
        return true;
    } catch (err) {
        log(`Failed to register slash commands: ${err.message}`, 'error');
        return false;
    }
}

// Trigger Shutdown Signal to Local Agent
function dispatchShutdownSignal(seconds = 10, triggeredBy = 'Web Dashboard') {
    if (connectedAgents.size === 0) {
        return { success: false, message: 'No local PC agent is currently connected!' };
    }

    if (activeShutdownSeconds > 0) {
        return { success: false, message: 'A shutdown countdown is ALREADY active!' };
    }

    log(`Dispatching shutdown signal to ${connectedAgents.size} agent(s) (Delay: ${seconds}s) by ${triggeredBy}...`, 'warn');

    activeShutdownSeconds = seconds;

    const payload = JSON.stringify({
        type: 'EXECUTE_SHUTDOWN',
        seconds,
        triggeredBy
    });

    connectedAgents.forEach((agentWs) => {
        if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(payload);
        }
    });

    countdownInterval = setInterval(() => {
        activeShutdownSeconds -= 1;
        broadcastState();
        if (activeShutdownSeconds <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }, 1000);

    broadcastState();
    return { success: true, message: `Shutdown signal sent to PC agent! (${seconds}s remaining)` };
}

// Trigger Abort Signal to Local Agent
function dispatchCancelSignal(triggeredBy = 'Web Dashboard') {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
    activeShutdownSeconds = 0;

    log(`Dispatching ABORT signal to connected local PC agents by ${triggeredBy}...`, 'info');

    const payload = JSON.stringify({
        type: 'CANCEL_SHUTDOWN',
        triggeredBy
    });

    connectedAgents.forEach((agentWs) => {
        if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(payload);
        }
    });

    broadcastState();
    return { success: true, message: `Shutdown canceled successfully!` };
}

// Trigger Warning Overlay on PC Screen
function dispatchWarningSignal(customMessage, triggeredBy = 'Web Dashboard') {
    if (connectedAgents.size === 0) {
        return { success: false, message: 'No local PC agent is connected!' };
    }

    activeWarningState = true;
    const msgText = customMessage || '⚠️ WARNING: THE PC IS TURNING HOT! ⚠️';
    log(`Dispatching GIANT WARNING overlay to PC screen by ${triggeredBy}: "${msgText}"`, 'warn');

    const payload = JSON.stringify({
        type: 'SHOW_WARNING',
        message: msgText,
        triggeredBy
    });

    connectedAgents.forEach((agentWs) => {
        if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(payload);
        }
    });

    broadcastState();
    return { success: true, message: 'Giant warning screen displayed on PC!' };
}

function dispatchStopWarningSignal(triggeredBy = 'Web Dashboard') {
    activeWarningState = false;
    log(`Dispatching STOP WARNING signal to PC by ${triggeredBy}...`, 'info');

    const payload = JSON.stringify({
        type: 'STOP_WARNING',
        triggeredBy
    });

    connectedAgents.forEach((agentWs) => {
        if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(payload);
        }
    });

    broadcastState();
    return { success: true, message: 'PC Warning screen closed.' };
}

// Bot Control Functions
async function startBot() {
    if (!config.token || !config.clientId) {
        log('Cannot start bot: DISCORD_TOKEN and CLIENT_ID are required.', 'error');
        botStatus = 'ERROR';
        broadcastState();
        return false;
    }

    if (client) {
        try { await client.destroy(); } catch (e) {}
    }

    botStatus = 'CONNECTING';
    log('Connecting Discord Bot to Discord Gateway...', 'info');
    broadcastState();

    client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages
        ]
    });

    client.on('ready', async () => {
        botStatus = 'ONLINE';
        log(`Bot logged in as @${client.user.tag}!`, 'success');
        await registerSlashCommands(config.token, config.clientId, config.guildId);
        broadcastState();
    });

    client.on('error', (err) => {
        log(`Discord Bot Error: ${err.message}`, 'error');
        botStatus = 'ERROR';
        broadcastState();
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isChatInputCommand()) {
                const { commandName } = interaction;

                if (commandName === 'ping') {
                    await interaction.reply({ 
                        content: `🏓 Pong! Bot Latency: \`${client.ws.ping}ms\` | Agents Connected: \`${connectedAgents.size}\``, 
                        ephemeral: true 
                    });
                }

                else if (commandName === 'status') {
                    const agentList = Array.from(connectedAgents.keys()).join(', ') || 'None';
                    const embed = new EmbedBuilder()
                        .setTitle('⚡ Discord PC Controller Status')
                        .setColor(connectedAgents.size > 0 ? 0x00FF88 : 0xFFB300)
                        .addFields(
                            { name: '🤖 Bot Status', value: `\`ONLINE\` (@${client.user.tag})`, inline: true },
                            { name: '💻 Connected PC Agents', value: `\`${connectedAgents.size}\` (${agentList})`, inline: true },
                            { name: '🚨 Active Warning', value: activeWarningState ? '`YES (Flashing Warning Screen)`' : '`None`', inline: true },
                            { name: '⏱️ Shutdown Timer', value: activeShutdownSeconds > 0 ? `\`${activeShutdownSeconds}s remaining\`` : '`None`', inline: true }
                        )
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed] });
                }

                else if (commandName === 'shutdown') {
                    const seconds = interaction.options.getInteger('seconds') || config.shutdownDelay || 10;

                    if (connectedAgents.size === 0) {
                        await interaction.reply({ 
                            content: `❌ **No Local PC Agent Connected!**`, 
                            ephemeral: true 
                        });
                        return;
                    }

                    if (activeShutdownSeconds > 0) {
                        await interaction.reply({ 
                            content: `⚠️ A shutdown is **ALREADY** in progress! \`${activeShutdownSeconds}s\` left. Use \`/cancel\` to abort.`, 
                            ephemeral: true 
                        });
                        return;
                    }

                    const res = dispatchShutdownSignal(seconds, `@${interaction.user.tag}`);
                    if (!res.success) {
                        await interaction.reply({ content: `❌ ${res.message}`, ephemeral: true });
                        return;
                    }

                    const cancelBtn = new ButtonBuilder()
                        .setCustomId('btn_cancel_shutdown')
                        .setLabel('ABORT SHUTDOWN')
                        .setStyle(ButtonStyle.Danger);

                    const row = new ActionRowBuilder().addComponents(cancelBtn);

                    const embed = new EmbedBuilder()
                        .setTitle('🚨 PC SHUTDOWN INITIATED')
                        .setDescription(`Target PC will shut down in **${seconds} seconds**!\n\nTriggered by: <@${interaction.user.id}>\nClick below or type \`/cancel\` to abort!`)
                        .setColor(0xFF0033)
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed], components: [row] });
                }

                else if (commandName === 'cancel') {
                    dispatchCancelSignal(`@${interaction.user.tag}`);
                    await interaction.reply({ 
                        content: `✅ **SHUTDOWN ABORTED** by <@${interaction.user.id}>! Computer will stay on.`, 
                        ephemeral: false 
                    });
                }

                else if (commandName === 'warning') {
                    const customMsg = interaction.options.getString('message') || '⚠️ WARNING: THE PC IS TURNING HOT! ⚠️';
                    const res = dispatchWarningSignal(customMsg, `@${interaction.user.tag}`);

                    if (!res.success) {
                        await interaction.reply({ content: `❌ ${res.message}`, ephemeral: true });
                        return;
                    }

                    const stopBtn = new ButtonBuilder()
                        .setCustomId('btn_stop_warning')
                        .setLabel('STOP WARNING SCREEN')
                        .setStyle(ButtonStyle.Success);

                    const row = new ActionRowBuilder().addComponents(stopBtn);

                    const embed = new EmbedBuilder()
                        .setTitle('🔥 GIANT PC WARNING DISPLAYED!')
                        .setDescription(`Displaying warning screen on PC monitor!\n\n**Text:** \`${customMsg}\` \n\nTriggered by: <@${interaction.user.id}>\nType \`/stopwarning\` or click button to close.`)
                        .setColor(0xFF8800)
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed], components: [row] });
                }

                else if (commandName === 'stopwarning') {
                    dispatchStopWarningSignal(`@${interaction.user.tag}`);
                    await interaction.reply({ content: `✅ **PC Warning Screen Closed** by <@${interaction.user.id}>!`, ephemeral: false });
                }
            }

            else if (interaction.isButton()) {
                if (interaction.customId === 'btn_cancel_shutdown') {
                    dispatchCancelSignal(`@${interaction.user.tag}`);
                    const embed = new EmbedBuilder()
                        .setTitle('🛑 SHUTDOWN ABORTED')
                        .setDescription(`Shutdown process was canceled by <@${interaction.user.id}>.`)
                        .setColor(0x00FF88)
                        .setTimestamp();
                    
                    await interaction.update({ embeds: [embed], components: [] });
                } else if (interaction.customId === 'btn_stop_warning') {
                    dispatchStopWarningSignal(`@${interaction.user.tag}`);
                    const embed = new EmbedBuilder()
                        .setTitle('✅ WARNING CLOSED')
                        .setDescription(`Warning screen closed by <@${interaction.user.id}>.`)
                        .setColor(0x00FF88)
                        .setTimestamp();

                    await interaction.update({ embeds: [embed], components: [] });
                }
            }
        } catch (err) {
            log(`Interaction error: ${err.message}`, 'error');
        }
    });

    try {
        await client.login(config.token);
        return true;
    } catch (err) {
        log(`Bot Login Failed: ${err.message}`, 'error');
        botStatus = 'ERROR';
        broadcastState();
        return false;
    }
}

async function stopBot() {
    if (client) {
        log('Stopping Discord Bot...', 'info');
        await client.destroy();
        client = null;
        botStatus = 'OFFLINE';
        broadcastState();
        return true;
    }
    return false;
}

function getSystemStatus() {
    return {
        botStatus,
        botTag: client?.user?.tag || null,
        hostname: os.hostname(),
        platform: os.platform(),
        connectedAgentsCount: connectedAgents.size,
        connectedAgents: Array.from(connectedAgents.keys()),
        shutdownTimeRemaining: activeShutdownSeconds,
        activeWarningState,
        config: {
            hasToken: Boolean(config.token),
            clientId: config.clientId,
            guildId: config.guildId,
            shutdownDelay: config.shutdownDelay
        }
    };
}

// REST API
app.get('/api/status', (req, res) => res.json(getSystemStatus()));

app.get('/api/config', (req, res) => {
    res.json({
        token: config.token ? '••••••••••••••••' + config.token.slice(-4) : '',
        rawToken: config.token,
        clientId: config.clientId,
        guildId: config.guildId,
        shutdownDelay: config.shutdownDelay,
        agentSecret: config.agentSecret
    });
});

app.post('/api/config', (req, res) => {
    const { token, clientId, guildId, shutdownDelay, agentSecret } = req.body;
    saveConfig({
        token: token || config.token,
        clientId: clientId !== undefined ? clientId : config.clientId,
        guildId: guildId !== undefined ? guildId : config.guildId,
        agentSecret: agentSecret || config.agentSecret,
        shutdownDelay: shutdownDelay ? parseInt(shutdownDelay) : config.shutdownDelay
    });
    log('Configuration updated.', 'info');
    res.json({ success: true, message: 'Settings saved.' });
});

app.post('/api/bot/start', async (req, res) => {
    const success = await startBot();
    res.json({ success, botStatus });
});

app.post('/api/bot/stop', async (req, res) => {
    const success = await stopBot();
    res.json({ success, botStatus });
});

app.post('/api/shutdown/start', (req, res) => {
    const seconds = req.body.seconds || config.shutdownDelay || 10;
    const result = dispatchShutdownSignal(seconds, 'Web Dashboard UI');
    res.json(result);
});

app.post('/api/shutdown/cancel', (req, res) => {
    const result = dispatchCancelSignal('Web Dashboard UI');
    res.json(result);
});

app.post('/api/warning/start', (req, res) => {
    const msg = req.body.message;
    const result = dispatchWarningSignal(msg, 'Web Dashboard UI');
    res.json(result);
});

app.post('/api/warning/stop', (req, res) => {
    const result = dispatchStopWarningSignal('Web Dashboard UI');
    res.json(result);
});

app.get('/api/logs', (req, res) => res.json(logs));

// WebSocket Handling
wss.on('connection', (ws, req) => {
    ws.isUI = true;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'AGENT_REGISTER') {
                if (data.secret !== config.agentSecret) {
                    log(`Agent registration rejected: Invalid secret!`, 'error');
                    ws.send(JSON.stringify({ type: 'REGISTER_FAILED', reason: 'Invalid secret key' }));
                    ws.close();
                    return;
                }

                ws.isUI = false;
                ws.agentHostname = data.hostname || 'Unknown-PC';
                connectedAgents.set(ws.agentHostname, ws);

                log(`🟢 PC Agent connected: ${ws.agentHostname}`, 'success');
                ws.send(JSON.stringify({ type: 'REGISTER_OK' }));
                broadcastState();
            }

            else if (data.type === 'AGENT_LOG') {
                log(`[Agent ${ws.agentHostname}] ${data.msg}`, data.level || 'info');
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        if (ws.agentHostname) {
            connectedAgents.delete(ws.agentHostname);
            log(`🔴 PC Agent disconnected: ${ws.agentHostname}`, 'warn');
            broadcastState();
        }
    });

    ws.send(JSON.stringify({ type: 'init', data: { state: getSystemStatus(), logs } }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Discord PC Controller Cloud Server online!`);
    console.log(`🌐 Server Port: ${PORT}`);
    console.log(`==================================================\n`);
    log(`Server running on port ${PORT}`, 'info');

    if (config.token && config.clientId) {
        log('Auto-starting Discord Bot...', 'info');
        startBot();
    }
});
