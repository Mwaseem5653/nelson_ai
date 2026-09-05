const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const mime = require('mime-types');

const BRIDGE_PORT = parseInt(process.env.WA_BRIDGE_PORT || "3100", 10);
const BACKEND_URL = process.env.WA_BACKEND_URL || "http://localhost:9001";
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET || "change-me";
const MEDIA_DIR = process.env.WA_MEDIA_DIR || path.join(__dirname, "uploads", "wa");

// Create media directory
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    console.log(`📁 Created media directory: ${MEDIA_DIR}`);
}

// State tracking
let state = {
    status: "starting",
    qr: null,
    ready: false,
    updated_at: Date.now(),
    connection_details: null
};

function setState(patch) {
    state = { ...state, ...patch, updated_at: Date.now() };
}

let sock = null;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
let connectionStable = false;
let lastMessageTime = Date.now();
let lidToPhoneMap = new Map(); // Store LID to phone number mapping

const logger = P({
    level: 'silent',
    browser: ['Nelson WA Bridge', 'Chrome', '1.0.0']
});

// ========== MEDIA DOWNLOAD FUNCTION ==========
async function downloadMediaMessage(msg) {
    try {
        console.log('📥 Downloading media...');
        
        // Determine the type of media
        let mediaType = null;
        let mediaMessage = null;
        
        if (msg.message.imageMessage) {
            mediaType = 'image';
            mediaMessage = msg.message.imageMessage;
        } else if (msg.message.videoMessage) {
            mediaType = 'video';
            mediaMessage = msg.message.videoMessage;
        } else if (msg.message.audioMessage) {
            mediaType = 'audio';
            mediaMessage = msg.message.audioMessage;
        } else if (msg.message.documentMessage) {
            mediaType = 'document';
            mediaMessage = msg.message.documentMessage;
        } else if (msg.message.stickerMessage) {
            mediaType = 'sticker';
            mediaMessage = msg.message.stickerMessage;
        } else {
            console.log('⚠️ Unknown media type');
            return null;
        }

        if (!mediaMessage) {
            console.log('⚠️ No media message found');
            return null;
        }

        // Get media stream
        const stream = await downloadContentFromMessage(
            mediaMessage,
            mediaType
        );

        // Collect the stream into a buffer
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Determine file extension
        let ext = 'bin';
        if (mediaType === 'image') ext = 'jpg';
        else if (mediaType === 'video') ext = 'mp4';
        else if (mediaType === 'audio') ext = 'ogg';
        else if (mediaType === 'document') {
            ext = mediaMessage.fileName ? path.extname(mediaMessage.fileName).substring(1) || 'bin' : 'bin';
        } else if (mediaType === 'sticker') ext = 'webp';

        // Generate filename
        const timestamp = Math.floor(Date.now() / 1000);
        const id = msg.key.id ? msg.key.id.slice(-8) : 'x';
        const filename = `wa_${timestamp}_${id}.${ext}`;
        const filePath = path.join(MEDIA_DIR, filename);

        // Save file
        fs.writeFileSync(filePath, buffer);
        console.log(`✅ Media saved: ${filename} (${buffer.length} bytes)`);

        // Determine mime type
        let mimeType = mediaMessage.mimetype || mime.lookup(ext) || 'application/octet-stream';
        let originalFilename = mediaMessage.fileName || filename;

        return {
            filePath: filePath,
            mimeType: mimeType,
            filename: originalFilename,
            size: buffer.length
        };
    } catch (error) {
        console.error('❌ Error downloading media:', error.message);
        return null;
    }
}

// ========== PHONE NUMBER EXTRACTION ==========
function extractSenderNumber(msg) {
    try {
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        
        console.log(`🔍 Extracting number from: ${from}`);
        
        if (!isGroup) {
            // Check for LID
            if (from.endsWith('@lid')) {
                console.log('🆔 LID detected:', from);
                
                // Check if we have a mapping for this LID
                if (lidToPhoneMap.has(from)) {
                    const phoneNumber = lidToPhoneMap.get(from);
                    console.log(`✅ Found LID mapping: ${from} -> ${phoneNumber}`);
                    return phoneNumber;
                }
                
                // Try to extract phone from participantAlt
                if (msg.key.participantAlt && msg.key.participantAlt.includes('@s.whatsapp.net')) {
                    const phoneNumber = msg.key.participantAlt.split('@')[0];
                    console.log(`✅ Found in participantAlt: ${phoneNumber}`);
                    // Store the mapping
                    lidToPhoneMap.set(from, phoneNumber);
                    return phoneNumber;
                }
                
                // Try to extract from remoteJidAlt
                if (msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
                    const phoneNumber = msg.key.remoteJidAlt.split('@')[0];
                    console.log(`✅ Found in remoteJidAlt: ${phoneNumber}`);
                    lidToPhoneMap.set(from, phoneNumber);
                    return phoneNumber;
                }
                
                console.log('⚠️ No phone number found for LID, using raw value');
                return from;
            }
            
            // Regular phone number
            if (from.endsWith('@s.whatsapp.net')) {
                const phoneNumber = from.split('@')[0];
                console.log(`✅ Phone number: ${phoneNumber}`);
                return phoneNumber;
            }
            
            // Other formats
            console.log(`⚠️ Unknown format: ${from}`);
            return from.split('@')[0];
        }
        
        // Group message
        const participant = msg.key.participant;
        if (!participant) {
            console.log('⚠️ No participant in group message');
            return 'unknown';
        }
        
        console.log(`👥 Group message from participant: ${participant}`);
        
        // Check if participant is a LID
        if (participant.endsWith('@lid')) {
            console.log('🆔 Participant is LID:', participant);
            
            if (lidToPhoneMap.has(participant)) {
                const phoneNumber = lidToPhoneMap.get(participant);
                console.log(`✅ Found LID mapping: ${participant} -> ${phoneNumber}`);
                return phoneNumber;
            }
            
            // Try to extract from participantAlt or remoteJidAlt
            if (msg.key.participantAlt && msg.key.participantAlt.includes('@s.whatsapp.net')) {
                const phoneNumber = msg.key.participantAlt.split('@')[0];
                console.log(`✅ Found in participantAlt: ${phoneNumber}`);
                lidToPhoneMap.set(participant, phoneNumber);
                return phoneNumber;
            }
            
            if (msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
                const phoneNumber = msg.key.remoteJidAlt.split('@')[0];
                console.log(`✅ Found in remoteJidAlt: ${phoneNumber}`);
                lidToPhoneMap.set(participant, phoneNumber);
                return phoneNumber;
            }
        }
        
        // Regular participant
        const phoneNumber = participant.split('@')[0];
        console.log(`✅ Participant number: ${phoneNumber}`);
        return phoneNumber;
    } catch (error) {
        console.error('❌ Error extracting sender:', error.message);
        return 'unknown';
    }
}

// ========== FORMAT PHONE NUMBER ==========
function formatPhoneNumber(phone) {
    if (!phone) return phone;
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned) return phone;
    
    // If it's a LID or has @, return as is
    if (phone.includes('@') || phone.includes('lid')) {
        return phone;
    }
    
    if (cleaned.startsWith('92') && cleaned.length === 12) {
        cleaned = cleaned.substring(2);
    }
    if (cleaned.length === 10) {
        cleaned = '0' + cleaned;
    }
    if (cleaned.length >= 11) {
        let part1 = cleaned.substring(0, 4);
        let part2 = cleaned.substring(4, 11);
        return part1 + '-' + part2;
    }
    return cleaned;
}

// ========== WHATSAPP CONNECTION ==========
async function connectToWhatsApp() {
    if (isConnecting) {
        console.log('⏳ Already connecting...');
        return;
    }
    isConnecting = true;
    
    try {
        console.log('🔄 Connecting to WhatsApp...');
        
        const { state: authState, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        sock = makeWASocket({
            auth: authState,
            printQRInTerminal: true,
            logger: logger,
            browser: ['Nelson WA Bridge', 'Chrome', '1.0.0'],
            markOnlineOnConnect: true,
            syncFullHistory: false,
            connectTimeoutMs: 30000,
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 15000,
            emitOwnEvents: false,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (msg) => {
                return msg;
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
                    setState({ status: "waiting_qr", qr: dataUrl, ready: false });
                    console.log('📱 QR Code generated! Scan with WhatsApp.');
                } catch (e) {
                    console.error('[WA] QR error:', e.message);
                }
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = statusCode !== 401;
                
                setState({ status: "disconnected", ready: false, qr: null });
                console.log(`⚠️ Connection closed. Status: ${statusCode || 'unknown'}`);
                console.log(`🔄 Should reconnect: ${shouldReconnect}`);
                
                if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    const delay = Math.min(5000 * reconnectAttempts, 30000);
                    console.log(`⏳ Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => {
                        isConnecting = false;
                        connectToWhatsApp();
                    }, delay);
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log('❌ Max reconnect attempts reached. Manual restart needed.');
                    setState({ status: "failed", ready: false });
                } else {
                    console.log('❌ Authentication failed. Please restart and scan QR again.');
                    if (fs.existsSync('./auth_info_baileys')) {
                        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
                        console.log('🗑️ Auth data cleared. Restart to scan QR again.');
                    }
                }
                isConnecting = false;
            }

            if (connection === 'open') {
                setState({ 
                    status: "ready", 
                    ready: true, 
                    qr: null,
                    connection_details: {
                        connected: true,
                        timestamp: new Date().toISOString()
                    }
                });
                reconnectAttempts = 0;
                connectionStable = true;
                console.log('✅ WhatsApp connected!');
                
                if (sock.authState?.creds?.me) {
                    console.log(`📱 Connected as: ${sock.authState.creds.me.name || 'Unknown'}`);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (msg.key.fromMe) {
                    console.log('⏭️ Skipping own message');
                    return;
                }
                
                lastMessageTime = Date.now();
                const from = msg.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                
                console.log(`\n📨 New message from: ${from}`);
                
                const senderPhone = extractSenderNumber(msg);
                const pushName = msg.pushName || 'Unknown';
                const formattedPhone = formatPhoneNumber(senderPhone);
                
                console.log(`📞 Phone: ${senderPhone}`);
                console.log(`📱 Formatted: ${formattedPhone}`);
                
                let messageText = '';
                let hasMedia = false;
                let mediaData = null;
                let msgType = 'chat';
                
                // Extract text based on message type
                if (msg.message.conversation) {
                    messageText = msg.message.conversation;
                    msgType = 'chat';
                } else if (msg.message.extendedTextMessage) {
                    messageText = msg.message.extendedTextMessage.text;
                    msgType = 'chat';
                } else if (msg.message.imageMessage) {
                    messageText = msg.message.imageMessage.caption || '📷 Image received';
                    hasMedia = true;
                    msgType = 'image';
                } else if (msg.message.audioMessage) {
                    messageText = '🎵 Audio message received';
                    hasMedia = true;
                    msgType = 'audio';
                } else if (msg.message.videoMessage) {
                    messageText = '🎬 Video message received';
                    hasMedia = true;
                    msgType = 'video';
                } else if (msg.message.documentMessage) {
                    messageText = '📄 Document received';
                    hasMedia = true;
                    msgType = 'document';
                } else if (msg.message.stickerMessage) {
                    messageText = '🎨 Sticker received';
                    hasMedia = true;
                    msgType = 'sticker';
                } else if (msg.message.buttonsResponseMessage) {
                    messageText = msg.message.buttonsResponseMessage.selectedButtonId || 'Button response';
                } else if (msg.message.listResponseMessage) {
                    messageText = msg.message.listResponseMessage.title || 'List response';
                } else {
                    messageText = `📩 Message received`;
                }
                
                console.log(`📝 Message (${msgType}): "${messageText}"`);
                
                // Download media if present
                if (hasMedia) {
                    console.log('📥 Media detected, downloading...');
                    mediaData = await downloadMediaMessage(msg);
                    if (mediaData) {
                        console.log(`✅ Media downloaded: ${mediaData.filename}`);
                    }
                }
                
                // Prepare payload for backend
                const payload = {
                    wa_id: msg.key.id,
                    from: senderPhone || from,
                    from_jid: from,
                    push_name: pushName || '',
                    to: msg.key.participant || '',
                    body: messageText || '',
                    type: msgType,
                    timestamp: Math.floor(Date.now() / 1000),
                    has_media: hasMedia,
                    media_path: mediaData ? mediaData.filePath : null,
                    media_mime: mediaData ? mediaData.mimeType : null,
                    media_filename: mediaData ? mediaData.filename : null,
                };
                
                console.log(`📤 Sending to backend from: ${payload.from}`);
                
                try {
                    await axios.post(`${BACKEND_URL}/api/whatsapp/inbound`, payload, {
                        headers: { 'X-Bridge-Secret': BRIDGE_SECRET },
                        timeout: 30000,
                    });
                    console.log('✅ Message forwarded to backend');
                } catch (e) {
                    console.error('[WA] Relay error:', e.message);
                    if (e.response) {
                        console.error('Response status:', e.response.status);
                        console.error('Response data:', e.response.data);
                    }
                }
            } catch (error) {
                console.error('❌ Error processing message:', error.message);
            }
        });

        // Store LID mappings when we get them
        sock.ev.on('contacts.update', (updates) => {
            for (const update of updates) {
                if (update.id && update.id.endsWith('@lid') && update.verifiedName) {
                    console.log(`🆔 Found LID mapping: ${update.id} -> ${update.verifiedName}`);
                    // We could try to extract phone number from verifiedName
                    // Or store it for later
                }
            }
        });

        isConnecting = false;
        
    } catch (e) {
        console.error('[WA] Connection error:', e.message);
        isConnecting = false;
        setState({ status: "error", ready: false });
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Start connection
setTimeout(connectToWhatsApp, 1000);

// ========== HTTP API ==========
const app = express();
app.use(express.json({ limit: '50mb' }));

function auth(req, res, next) {
    if ((req.headers['x-bridge-secret'] || '') !== BRIDGE_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

app.get('/status', auth, (req, res) => {
    res.json({ 
        ...state, 
        connected: state.ready,
        lid_mappings: Array.from(lidToPhoneMap.entries())
    });
});

app.post('/send', auth, async (req, res) => {
    const { to, body } = req.body || {};
    console.log(`📩 Send request: to=${to}, body="${body?.substring(0, 50)}..."`);
    
    if (!to || typeof body !== 'string') {
        return res.status(400).json({ error: 'to and body required' });
    }
    if (!state.ready || !sock) {
        return res.status(409).json({ error: 'bridge not ready' });
    }
    
    // Set timeout to prevent hanging
    const timeout = setTimeout(() => {
        console.log('❌ Send timeout');
        res.status(504).json({ error: 'send timeout' });
    }, 15000);
    
    try {
        let chatId = to;
        
        // Check if it's already a JID
        if (!to.includes('@') && !to.includes(':')) {
            let phoneNumber = to.replace(/\D/g, '');
            
            // Handle Pakistani numbers
            if (phoneNumber.startsWith('0')) {
                phoneNumber = '92' + phoneNumber.substring(1);
            } else if (!phoneNumber.startsWith('92') && phoneNumber.length === 10) {
                phoneNumber = '92' + phoneNumber;
            }
            
            chatId = `${phoneNumber}@s.whatsapp.net`;
            console.log(`📱 Formatted chat ID: ${chatId}`);
        }
        
        // If it's a group, use as is
        if (to.includes('g.us')) {
            chatId = to;
        }
        
        console.log(`📤 Sending message to ${chatId}`);
        const result = await sock.sendMessage(chatId, { 
            text: body,
            linkPreview: false // Disable link previews for faster sending
        });
        clearTimeout(timeout);
        console.log(`✅ Message sent! ID: ${result.key.id}`);
        res.json({ ok: true, id: result.key.id });
    } catch (e) {
        clearTimeout(timeout);
        console.error('[WA] Send error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/restart', auth, async (req, res) => {
    try {
        setState({ status: "restarting", ready: false, connection_details: null });
        reconnectAttempts = 0;
        isConnecting = false;
        if (sock) {
            await sock.end();
        }
        setTimeout(connectToWhatsApp, 2000);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/healthz', (req, res) => {
    res.json({ ok: true, status: state.status, ready: state.ready });
});

app.listen(BRIDGE_PORT, () => {
    console.log(`[WA] Bridge listening on :${BRIDGE_PORT}`);
    console.log(`[WA] Backend URL: ${BACKEND_URL}`);
    console.log(`[WA] Bridge Secret: ${BRIDGE_SECRET.substring(0, 8)}...`);
    console.log(`[WA] Media directory: ${MEDIA_DIR}`);
    console.log(`[WA] v7.0.0-rc14`);
});