const { spawn } = require('child_process');
const path = require('path');

// サーバープロセスの起動
const serverPath = path.join(__dirname, '../build/index.js');
const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', process.stderr]
});

let messageBuffer = '';
let messageQueue = [];
let pendingRequests = new Map();
let requestId = 0;

// メッセージパース
server.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[RAW] ${text.trim()}`);
    messageBuffer += text;
    const parts = messageBuffer.split('\n');
    messageBuffer = parts.pop(); // 最後の不完全な部分は残す

    for (const part of parts) {
        if (!part.trim()) continue;
        try {
            const message = JSON.parse(part);
            if (message.id !== undefined) { // Check ID existence
                const msgId = String(message.id);
                if (pendingRequests.has(msgId) || pendingRequests.has(Number(msgId))) {
                    const req = pendingRequests.get(msgId) || pendingRequests.get(Number(msgId));
                    if (req) {
                        pendingRequests.delete(msgId);
                        pendingRequests.delete(Number(msgId));
                        if (message.error) {
                            req.reject(new Error(message.error.message));
                        } else {
                            req.resolve(message.result);
                        }
                    }
                }
            } else {
                // Notification etc.
                console.log('Notification:', JSON.stringify(message, null, 2));
            }
        } catch (e) {
            console.error('Failed to parse message:', e, part);
        }
    }
});

function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
        const id = String(requestId++);
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };
        pendingRequests.set(id, { resolve, reject });
        server.stdin.write(JSON.stringify(request) + '\n');
    });
}

function sendNotification(method, params) {
    const notification = {
        jsonrpc: '2.0',
        method,
        params
    };
    server.stdin.write(JSON.stringify(notification) + '\n');
}

async function runTest() {
    try {
        // Wait for server to start
        console.log('Waiting for server to start...');
        await new Promise(r => setTimeout(r, 2000));

        console.log('1. Initializing...');
        await sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' }
        });
        sendNotification('notifications/initialized', {});
        console.log('✅ Initialized');

        console.log('2. Starting GDB session...');
        const startRes = await sendRequest('tools/call', {
            name: 'gdb_start',
            arguments: { workingDir: path.join(__dirname, '.') }
        });
        console.log('✅ GDB Started');
        // Extract sessionId from output text if possible, but list_sessions is better
        // Wait a bit just in case
        await new Promise(r => setTimeout(r, 1000));

        // Get Session ID
        const listRes = await sendRequest('tools/call', { name: 'gdb_list_sessions', arguments: {} });
        const listText = listRes.content[0].text;
        const sessionIdMatch = listText.match(/"id": "(\d+)"/);
        if (!sessionIdMatch) throw new Error('Could not get session ID');
        const sessionId = sessionIdMatch[1];
        console.log(`✅ Session ID: ${sessionId}`);

        // Enable async mode
        console.log('3. Enabling target-async...');
        await sendRequest('tools/call', {
            name: 'gdb_command',
            arguments: { sessionId, command: 'gdb-set target-async on' }
        });
        console.log('✅ Async mode enabled');

        // Load loop program
        console.log('4. Loading program (test/loop)...');
        await sendRequest('tools/call', {
            name: 'gdb_load',
            arguments: { sessionId, program: 'loop' }
        });
        console.log('✅ Program loaded');

        // Run program
        console.log('5. Running program (async)...');
        // We expect this to return immediately because of previous fixes (using executeGdbCommand without waiting for stop)
        await sendRequest('tools/call', {
            name: 'gdb_command',
            arguments: { sessionId, command: 'exec-run' }
        });
        console.log('✅ Program running');

        // Wait meant for loop to start
        await new Promise(r => setTimeout(r, 1000));

        // Interrupt using MI command (useSigint: false)
        console.log('6. Interrupting with MI command...');
        const interruptRes = await sendRequest('tools/call', {
            name: 'gdb_interrupt',
            arguments: { sessionId, useSigint: false }
        });

        console.log('Interrupt Result:', JSON.stringify(interruptRes, null, 2));

        if (interruptRes.content[0].text.includes('MI-Command')) {
            console.log('✅ Successfully interrupted using MI Command');
        } else {
            throw new Error('Interrupt response does not indicate MI Command usage');
        }

        // Terminate
        console.log('7. Terminating...');
        await sendRequest('tools/call', {
            name: 'gdb_terminate',
            arguments: { sessionId }
        });
        console.log('✅ Terminated');

        process.exit(0);

    } catch (err) {
        console.error('❌ Test Failed:', err);
        process.exit(1);
    } finally {
        server.kill();
    }
}

runTest();
