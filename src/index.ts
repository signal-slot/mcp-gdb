#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { MiParser } from './mi-parser.js';

// GDB MI Output Types
interface MiResult {
  token?: number;
  class: 'done' | 'running' | 'connected' | 'error' | 'exit';
  data: Record<string, any>;
}

interface MiAsyncRecord {
  token?: number;
  type: 'exec' | 'status' | 'notify';
  class: string;
  data: Record<string, any>;
}

interface MiStreamRecord {
  type: 'console' | 'target' | 'log';
  content: string;
}

// Interface for GDB session
interface GdbSession {
  process: ChildProcess;
  rl: readline.Interface;
  ready: boolean;
  id: string;
  target?: string;
  workingDir?: string;

  // New fields for async handling
  tokenSequence: number;
  pendingCommands: Map<number, (result: MiResult) => void>;
  status: 'stopped' | 'running';
  stopHandler?: (record: MiAsyncRecord) => void;
  outputBuffer: string; // Accumulate console output
}

// Map to store active GDB sessions
const activeSessions = new Map<string, GdbSession>();

// Server metadata for restart verification
const SERVER_START_TIME = new Date().toISOString();

class GdbServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-gdb-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      // Clean up all active GDB sessions
      for (const [id, session] of activeSessions.entries()) {
        await this.terminateGdbSession(id);
      }
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'gdb_start',
          description: 'Start a new GDB session',
          inputSchema: {
            type: 'object',
            properties: {
              gdbPath: {
                type: 'string',
                description: 'Path to the GDB executable (optional, defaults to "gdb")'
              },
              workingDir: {
                type: 'string',
                description: 'Working directory for GDB (optional)'
              }
            }
          }
        },
        {
          name: 'gdb_load',
          description: 'Load a program into GDB',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              program: {
                type: 'string',
                description: 'Path to the program to debug'
              },
              arguments: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Command-line arguments for the program (optional)'
              }
            },
            required: ['sessionId', 'program']
          }
        },

        {
          name: 'gdb_command',
          description: 'Execute a GDB/MI command directly. Send raw MI commands (e.g., -data-evaluate-expression). Note: CLI commands via -interpreter-exec are not supported in many GDB versions.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              command: {
                type: 'string',
                description: 'GDB/MI command to execute. For "exec-interrupt" to work during execution, GDB must be in async mode (target-async on).'
              },
              isMiCommand: {
                type: 'boolean',
                description: 'Set to true if the command is a raw MI command'
              }
            },
            required: ['sessionId', 'command']
          }
        },
        {
          name: 'gdb_terminate',
          description: 'Terminate a GDB session',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_run',
          description: 'Run the loaded program. Equivalent to "run" command.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              arguments: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Command-line arguments for the program (optional)'
              },
              awaitStop: {
                type: 'boolean',
                description: 'Wait for program to stop (default: true). Set to false to return immediately (non-blocking run). Useful for async execution.'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_list_sessions',
          description: 'List all active GDB sessions',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'gdb_attach',
          description: 'Attach to a running process',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              pid: {
                type: 'number',
                description: 'Process ID to attach to'
              }
            },
            required: ['sessionId', 'pid']
          }
        },
        {
          name: 'gdb_load_core',
          description: 'Load a core dump file',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              program: {
                type: 'string',
                description: 'Path to the program executable'
              },
              corePath: {
                type: 'string',
                description: 'Path to the core dump file'
              }
            },
            required: ['sessionId', 'program', 'corePath']
          }
        },
        {
          name: 'gdb_set_breakpoint',
          description: 'Set a breakpoint',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              location: {
                type: 'string',
                description: 'Breakpoint location (e.g., function name, file:line)'
              },
              condition: {
                type: 'string',
                description: 'Breakpoint condition (optional)'
              }
            },
            required: ['sessionId', 'location']
          }
        },
        {
          name: 'gdb_continue',
          description: 'Continue program execution',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              awaitStop: {
                type: 'boolean',
                description: 'Wait for program to stop (default: true). Set to false to return immediately.'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_step',
          description: 'Step program execution',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              instructions: {
                type: 'boolean',
                description: 'Step by instructions instead of source lines (optional)'
              },
              awaitStop: {
                type: 'boolean',
                description: 'Wait for program to stop (default: true). Set to false to return immediately.'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_next',
          description: 'Step over function calls',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              instructions: {
                type: 'boolean',
                description: 'Step by instructions instead of source lines (optional)'
              },
              awaitStop: {
                type: 'boolean',
                description: 'Wait for program to stop (default: true). Set to false to return immediately.'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_finish',
          description: 'Execute until the current function returns',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              awaitStop: {
                type: 'boolean',
                description: 'Wait for program to stop (default: true). Set to false to return immediately.'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_backtrace',
          description: 'Show call stack',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              full: {
                type: 'boolean',
                description: 'Show variables in each frame (optional)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of frames to show (optional)'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_print',
          description: 'Print value of expression',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              expression: {
                type: 'string',
                description: 'Expression to evaluate'
              }
            },
            required: ['sessionId', 'expression']
          }
        },
        {
          name: 'gdb_examine',
          description: 'Examine memory',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              expression: {
                type: 'string',
                description: 'Memory address or expression'
              },
              format: {
                type: 'string',
                description: 'Display format (e.g., "x" for hex, "i" for instruction)'
              },
              count: {
                type: 'number',
                description: 'Number of units to display'
              }
            },
            required: ['sessionId', 'expression']
          }
        },
        {
          name: 'gdb_interrupt',
          description: 'Interrupt execution (send SIGINT). Use SIGINT (default) for reliable interruption even in synchronous mode.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              useSigint: {
                type: 'boolean',
                description: 'Use SIGINT signal to interrupt (default: true). Recommended. If false, uses -exec-interrupt MI command, which requires "target-async on" for running targets.'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_info_registers',
          description: 'Display registers',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'GDB session ID'
              },
              register: {
                type: 'string',
                description: 'Specific register to display (optional)'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'gdb_server_info',
          description: 'Get MCP server information (version, start time, etc.) - useful for verifying server restart',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Route the tool call to the appropriate handler based on the tool name
      switch (request.params.name) {
        case 'gdb_start':
          return await this.handleGdbStart(request.params.arguments);
        case 'gdb_load':
          return await this.handleGdbLoad(request.params.arguments);
        case 'gdb_command':
          return await this.handleGdbCommand(request.params.arguments);
        case 'gdb_run':
          return await this.handleGdbRun(request.params.arguments);
        case 'gdb_terminate':
          return await this.handleGdbTerminate(request.params.arguments);
        case 'gdb_list_sessions':
          return await this.handleGdbListSessions();
        case 'gdb_attach':
          return await this.handleGdbAttach(request.params.arguments);
        case 'gdb_load_core':
          return await this.handleGdbLoadCore(request.params.arguments);
        case 'gdb_set_breakpoint':
          return await this.handleGdbSetBreakpoint(request.params.arguments);
        case 'gdb_continue':
          return await this.handleGdbContinue(request.params.arguments);
        case 'gdb_step':
          return await this.handleGdbStep(request.params.arguments);
        case 'gdb_next':
          return await this.handleGdbNext(request.params.arguments);
        case 'gdb_finish':
          return await this.handleGdbFinish(request.params.arguments);
        case 'gdb_backtrace':
          return await this.handleGdbBacktrace(request.params.arguments);
        case 'gdb_print':
          return await this.handleGdbPrint(request.params.arguments);
        case 'gdb_examine':
          return await this.handleGdbExamine(request.params.arguments);
        case 'gdb_info_registers':
          return await this.handleGdbInfoRegisters(request.params.arguments);
        case 'gdb_interrupt':
          return await this.handleGdbInterrupt(request.params.arguments);
        case 'gdb_server_info':
          return await this.handleGdbServerInfo();
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleGdbStart(args: any) {
    const gdbPath = args.gdbPath || 'gdb';
    const workingDir = args.workingDir || process.cwd();

    // Create a unique session ID
    const sessionId = Date.now().toString();

    try {
      // Start GDB process with MI mode enabled for machine interface
      const gdbProcess = spawn(gdbPath, ['--interpreter=mi'], {
        cwd: workingDir,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Create readline interface for reading GDB output
      const rl = readline.createInterface({
        input: gdbProcess.stdout,
        terminal: false
      });

      // Create new GDB session
      const session: GdbSession = {
        process: gdbProcess,
        rl,
        ready: false,
        id: sessionId,
        workingDir,
        tokenSequence: 1,
        pendingCommands: new Map(),
        status: 'stopped',
        outputBuffer: ''
      };

      // Store session in active sessions map
      activeSessions.set(sessionId, session);

      // Set up MI output parsing loop
      rl.on('line', (line) => {
        const parsed = MiParser.parse(line);
        if (!parsed) return;

        if (parsed.type === 'result') {
          const token = parsed.data.token;
          if (token && session.pendingCommands.has(token)) {
            const resolve = session.pendingCommands.get(token)!;
            session.pendingCommands.delete(token);
            resolve(parsed.data);
          }
        } else if (parsed.type === 'async') {
          // Send notification for async events
          if (parsed.data.type === 'exec') {
            this.server.notification({
              method: `gdb/${parsed.data.class}`,
              params: {
                sessionId: session.id,
                data: parsed.data.data
              }
            });
          }

          // Handle *stopped, *running, etc.
          if (parsed.data.type === 'exec' && parsed.data.class === 'stopped') {
            session.status = 'stopped';
            if (session.stopHandler) {
              session.stopHandler(parsed.data);
              session.stopHandler = undefined;
            }
          } else if (parsed.data.type === 'exec' && parsed.data.class === 'running') {
            session.status = 'running';
          }
        } else if (parsed.type === 'stream') {
          // Accumulate console output
          if (parsed.data.type === 'console') {
            session.outputBuffer += parsed.data.content;
          }
        } else if (parsed.type === 'prompt') {
          // (gdb) prompt - indicate ready if not already
          if (!session.ready) {
            session.ready = true;
          }
        }
      });

      // Wait for GDB to be ready
      await new Promise<void>((resolve, reject) => {
        const checkReady = setInterval(() => {
          if (session.ready) {
            clearInterval(checkReady);
            resolve();
          }
        }, 100);

        // Timeout after 10s
        setTimeout(() => {
          clearInterval(checkReady);
          if (!session.ready) reject(new Error('GDB start timeout'));
        }, 10000);

        gdbProcess.on('error', (err) => {
          clearInterval(checkReady);
          reject(err);
        });

        gdbProcess.on('exit', (code) => {
          clearInterval(checkReady);
          if (!session.ready) {
            reject(new Error(`GDB process exited with code ${code}`));
          }
        });
      });

      return {
        content: [
          {
            type: 'text',
            text: `GDB session started with ID: ${sessionId}`
          }
        ]
      };

    } catch (error) {
      // Clean up if an error occurs
      if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId)!;
        session.process.kill();
        session.rl.close();
        activeSessions.delete(sessionId);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to start GDB: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbLoad(args: any) {
    const { sessionId, program, arguments: programArgs = [] } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Normalize path if working directory is set
      const normalizedPath = session.workingDir && !path.isAbsolute(program)
        ? path.resolve(session.workingDir, program)
        : program;

      // Update session target
      session.target = normalizedPath;

      // Execute file command to load program
      // Use -file-exec-and-symbols (verified to work with GDB 9.2)
      const loadCommand = `file-exec-and-symbols "${normalizedPath}"`;
      const { output: loadOutput } = await this.executeGdbCommand(session, loadCommand);

      // Set program arguments if provided
      let argsOutput = '';
      if (programArgs.length > 0) {
        // Use MI command -exec-arguments
        const argsCommand = `exec-arguments ${programArgs.join(' ')}`;
        const { output } = await this.executeGdbCommand(session, argsCommand);
        argsOutput = output;
      }

      return {
        content: [
          {
            type: 'text',
            text: `Program loaded: ${normalizedPath}\n\nOutput:\n${loadOutput}${argsOutput ? '\n' + argsOutput : ''}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to load program: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbCommand(args: any) {
    const { sessionId, command, isMiCommand } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Send command directly as MI command (no wrapper)
      const { output } = await this.executeGdbCommand(session, command);

      return {
        content: [
          {
            type: 'text',
            text: `Command: ${command}\n\nOutput:\n${output}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute command: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbRun(args: any) {
    const { sessionId, arguments: programArgs = [], awaitStop = true } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Set arguments if provided
      if (programArgs.length > 0) {
        const argsCommand = `exec-arguments ${programArgs.join(' ')}`;
        await this.executeGdbCommand(session, argsCommand);
      }

      // Execute run command
      await this.executeGdbCommand(session, "exec-run");

      if (!awaitStop) {
        return {
          content: [
            {
              type: 'text',
              text: `Program running (Async).`
            }
          ]
        };
      }

      // Wait for stop (e.g. breakpoint)
      const stopRecord = await this.waitForStop(session);

      return {
        content: [
          {
            type: 'text',
            text: `Program running. Stopped at: ${stopRecord.data.reason || 'unknown'}\n\n${JSON.stringify(stopRecord.data, null, 2)}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to run program: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbTerminate(args: any) {
    const { sessionId } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    try {
      await this.terminateGdbSession(sessionId);

      return {
        content: [
          {
            type: 'text',
            text: `GDB session terminated: ${sessionId}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to terminate GDB session: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbListSessions() {
    const sessions = Array.from(activeSessions.entries()).map(([id, session]) => ({
      id,
      target: session.target || 'No program loaded',
      workingDir: session.workingDir || process.cwd()
    }));

    return {
      content: [
        {
          type: 'text',
          text: `Active GDB Sessions (${sessions.length}):\n\n${JSON.stringify(sessions, null, 2)}`
        }
      ]
    };
  }

  private async handleGdbServerInfo() {
    // Read package.json for version info
    let version = '0.1.1';
    try {
      const packageJsonPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      version = packageJson.version;
    } catch (error) {
      // If we can't read package.json, use hardcoded version
    }

    // Get build time from the built file's modification time
    let buildTime = 'Unknown';
    try {
      const buildFilePath = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');
      const stats = fs.statSync(buildFilePath);
      buildTime = stats.mtime.toISOString();
    } catch (error) {
      // If we can't get build time, leave it as Unknown
    }

    const info = {
      version,
      serverStartTime: SERVER_START_TIME,
      buildTime,
      activeSessions: activeSessions.size,
      nodeVersion: process.version,
      platform: process.platform
    };

    return {
      content: [
        {
          type: 'text',
          text: `MCP GDB Server Information:\n\n${JSON.stringify(info, null, 2)}\n\n✅ Server Start Time: ${SERVER_START_TIME}\n📦 Version: ${version}\n🔨 Build Time: ${buildTime}\n🔧 Active Sessions: ${activeSessions.size}`
        }
      ]
    };
  }

  private async handleGdbAttach(args: any) {
    const { sessionId, pid } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Use MI command -target-attach
      const { output } = await this.executeGdbCommand(session, `target-attach ${pid}`);

      return {
        content: [
          {
            type: 'text',
            text: `Attached to process ${pid}\n\nOutput:\n${output}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to attach to process: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbLoadCore(args: any) {
    const { sessionId, program, corePath } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // First load the program
      let fileOutput = '';
      if (true) {
        // Strict MI
        const { output } = await this.executeGdbCommand(session, `file-exec-and-symbols "${program}"`);
        fileOutput = output;
      } else {
        // Use interpreter-exec console "file"
        const { output } = await this.executeGdbCommand(session, `interpreter-exec console "file \\"${program}\\""`);
        fileOutput = output;
      }

      // Then load the core file
      // GDB/MI usually doesn't have a direct core-file command, use interpreter-exec
      const { output: coreOutput } = await this.executeGdbCommand(session, `interpreter-exec console "core-file \\"${corePath}\\""`);

      // Get backtrace to show initial state
      const { output: backtraceOutput } = await this.executeGdbCommand(session, 'interpreter-exec console "backtrace"');

      return {
        content: [
          {
            type: 'text',
            text: `Core file loaded: ${corePath}\n\nOutput:\n${fileOutput}\n${coreOutput}\n\nBacktrace:\n${backtraceOutput}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to load core file: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbSetBreakpoint(args: any) {
    const { sessionId, location, condition } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Set breakpoint using MI -break-insert
      // If location is file:line, we use it directly. If it's function, same.
      // -break-insert [location]
      const { result, output } = await this.executeGdbCommand(session, `break-insert ${location}`);

      // Parse breakpoint info from result (bkpt={number="1",...})
      let bpNum = '';
      if (result.data && result.data.bkpt) {
        bpNum = result.data.bkpt.number;
      }

      // Set condition if provided
      let conditionOutput = '';
      if (condition && bpNum) {
        // -break-condition Number Expr
        const conditionCommand = `break-condition ${bpNum} ${condition}`;
        const { output } = await this.executeGdbCommand(session, conditionCommand);
        conditionOutput = output;
      }

      return {
        content: [
          {
            type: 'text',
            text: `Breakpoint set at: ${location}${condition ? ` with condition: ${condition}` : ''}\n\nOutput:\n${output}${conditionOutput ? '\n' + conditionOutput : ''}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to set breakpoint: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbContinue(args: any) {
    const { sessionId, awaitStop = true } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [{ type: 'text', text: `No active GDB session with ID: ${sessionId}` }],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // 1. Send continue command (expect ^running immediately)
      // Use MI command -exec-continue
      await this.executeGdbCommand(session, "exec-continue");

      if (!awaitStop) {
        return {
          content: [{
            type: 'text',
            text: `Program execution continued (Async).`
          }]
        };
      }

      // 2. Wait for *stopped
      // We wrap this in a timeout promise so we can return "Running..." if it takes too long
      const stopPromise = this.waitForStop(session);
      const timeoutPromise = new Promise<{ timeout: boolean }>((resolve) => {
        setTimeout(() => resolve({ timeout: true }), 2000); // 2s wait for synchronous-feel
      });

      const result: any = await Promise.race([stopPromise, timeoutPromise]);

      if (result.timeout) {
        return {
          content: [{
            type: 'text',
            text: `Program is running... (Command successful, waiting for stop)`
          }]
        };
      }

      // Program stopped
      const stopRecord = result as MiAsyncRecord;
      return {
        content: [{
          type: 'text',
          text: `Program stopped. Reason: ${stopRecord.data.reason || 'unknown'}\n\n${JSON.stringify(stopRecord.data, null, 2)}`
        }]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Failed to continue execution: ${errorMessage}` }],
      };
    }
  }

  private async handleGdbInterrupt(args: any) {
    const { sessionId, useSigint = true } = args;
    if (!activeSessions.has(sessionId)) {
      return {
        content: [{ type: 'text', text: `No active GDB session with ID: ${sessionId}` }],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;
    try {
      if (useSigint) {
        // Send interrupt via SIGINT
        session.process.kill('SIGINT');
      } else {
        // Send interrupt via MI command
        await this.executeGdbCommand(session, "exec-interrupt");
      }

      // Wait for stop
      const stopRecord = await this.waitForStop(session);

      return {
        content: [{
          type: 'text',
          text: `Program interrupted (${useSigint ? 'SIGINT' : 'MI-Command'}). Reason: ${stopRecord.data.reason}\n\n${JSON.stringify(stopRecord.data, null, 2)}`
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Failed to interrupt: ${errorMessage}` }],
        isError: true
      };
    }
  }

  private async handleGdbStep(args: any) {
    const { sessionId, instructions = false, awaitStop = true } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [{ type: 'text', text: `No active GDB session with ID: ${sessionId}` }],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Use MI commands
      const command = instructions ? "exec-step-instruction" : "exec-step";
      // executeGdbCommand waits for ^running (or ^done if synchronous?)
      // MI execution commands return ^running
      await this.executeGdbCommand(session, command);

      if (!awaitStop) {
        return {
          content: [{
            type: 'text',
            text: `Step initiated (Async).`
          }]
        };
      }

      // Wait for stop
      const stopRecord = await this.waitForStop(session);

      return {
        content: [{
          type: 'text',
          text: `Stepped ${instructions ? 'instruction' : 'line'}. Reason: ${stopRecord.data.reason}\n\n${JSON.stringify(stopRecord.data, null, 2)}`
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Failed to step: ${errorMessage}` }],
        isError: true
      };
    }
  }

  private async handleGdbNext(args: any) {
    const { sessionId, instructions = false, awaitStop = true } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [{ type: 'text', text: `No active GDB session with ID: ${sessionId}` }],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Use MI commands
      const command = instructions ? "exec-next-instruction" : "exec-next";
      await this.executeGdbCommand(session, command);

      if (!awaitStop) {
        return {
          content: [{
            type: 'text',
            text: `Next initiated (Async).`
          }]
        };
      }

      // Wait for stop
      const stopRecord = await this.waitForStop(session);

      return {
        content: [{
          type: 'text',
          text: `Stepped over ${instructions ? 'instruction' : 'function call'}. Reason: ${stopRecord.data.reason}\n\n${JSON.stringify(stopRecord.data, null, 2)}`
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Failed to step over: ${errorMessage}` }],
        isError: true
      };
    }
  }

  private async handleGdbFinish(args: any) {
    const { sessionId, awaitStop = true } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [{ type: 'text', text: `No active GDB session with ID: ${sessionId}` }],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Use MI command -exec-finish
      await this.executeGdbCommand(session, "exec-finish");

      if (!awaitStop) {
        return {
          content: [{
            type: 'text',
            text: `Finish initiated (Async).`
          }]
        };
      }

      const stopRecord = await this.waitForStop(session);

      return {
        content: [{
          type: 'text',
          text: `Finished current function. Reason: ${stopRecord.data.reason}\n\n${JSON.stringify(stopRecord.data, null, 2)}`
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Failed to finish function: ${errorMessage}` }],
        isError: true
      };
    }
  }

  private async handleGdbBacktrace(args: any) {
    const { sessionId, full = false, limit } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Build backtrace command with options
      // Use interpreter-exec console to maintain readable output
      let command = full ? "backtrace full" : "backtrace";
      if (typeof limit === 'number') {
        command += ` ${limit}`;
      }
      // Wrap in interpreter-exec
      const miCommand = `interpreter-exec console "${command}"`;

      const { output } = await this.executeGdbCommand(session, miCommand);

      return {
        content: [
          {
            type: 'text',
            text: `Backtrace${full ? ' (full)' : ''}${limit ? ` (limit: ${limit})` : ''}:\n\n${output}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get backtrace: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbPrint(args: any) {
    const { sessionId, expression } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Use interpreter-exec console for print to get readable output
      const { output } = await this.executeGdbCommand(session, `interpreter-exec console "print ${expression}"`);

      return {
        content: [
          {
            type: 'text',
            text: `Print ${expression}:\n\n${output}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to print expression: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbExamine(args: any) {
    const { sessionId, expression, format = 'x', count = 1 } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Format examine command: x/[count][format] [expression]
      const command = `x/${count}${format} ${expression}`;
      // Use interpreter-exec console
      const { output } = await this.executeGdbCommand(session, `interpreter-exec console "${command}"`);

      return {
        content: [
          {
            type: 'text',
            text: `Examine ${expression} (format: ${format}, count: ${count}):\n\n${output}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to examine memory: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGdbInfoRegisters(args: any) {
    const { sessionId, register } = args;

    if (!activeSessions.has(sessionId)) {
      return {
        content: [
          {
            type: 'text',
            text: `No active GDB session with ID: ${sessionId}`
          }
        ],
        isError: true
      };
    }

    const session = activeSessions.get(sessionId)!;

    try {
      // Build info registers command, optionally with specific register
      const command = register ? `info registers ${register}` : `info registers`;
      const { output } = await this.executeGdbCommand(session, `interpreter-exec console "${command}"`);

      return {
        content: [
          {
            type: 'text',
            text: `Register info${register ? ` for ${register}` : ''}:\n\n${output}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get register info: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Execute a GDB command and wait for the response
   */
  private executeGdbCommand(session: GdbSession, command: string): Promise<{ result: MiResult; output: string }> {
    return new Promise<{ result: MiResult; output: string }>((resolve, reject) => {
      if (!session.ready) {
        reject(new Error('GDB session is not ready'));
        return;
      }

      const token = session.tokenSequence++;
      // Clear previous output buffer to capture only this command's output
      session.outputBuffer = '';

      // Setup promise for command result
      session.pendingCommands.set(token, (result: MiResult) => {
        if (result.class === 'error') {
          reject(new Error(result.data.msg || 'Unknown GDB error'));
        } else {
          resolve({
            result,
            output: session.outputBuffer
          });
        }
      });

      // Write command to GDB's stdin with token
      if (session.process.stdin) {
        session.process.stdin.write(`${token}-${command}\n`);
      } else {
        session.pendingCommands.delete(token);
        reject(new Error('GDB stdin is not available'));
        return;
      }

      // Set a timeout
      // Execution commands like -exec-continue might take time to return ^running?
      // No, ^running comes reasonably fast. *stopped comes later.
      // So 10s timeout for the *acknowledgment* is fine.
      setTimeout(() => {
        if (session.pendingCommands.has(token)) {
          session.pendingCommands.delete(token);
          reject(new Error('GDB command timed out'));
        }
      }, 10000); // 10s default
    });
  }

  /**
   * Wait for specific async stop event
   */
  private waitForStop(session: GdbSession): Promise<MiAsyncRecord> {
    return new Promise<MiAsyncRecord>((resolve, reject) => {
      if (session.status === 'stopped') {
        // Already stopped?
        // resolve({ type: 'exec', class: 'stopped', data: {} }); 
        // Wait, maybe we just switched to running.
      }

      session.stopHandler = (record) => {
        resolve(record);
      };

      // Timeout for stop? (e.g. infinite loop protection)
      // For now let's make it infinite or long timeout? 
      // The user requested NO timeout for execution, but we should probably have a manual way to cancel.
      // The MCP tool call `gdb_continue` needs to return eventually.
      // If the program runs forever, `gdb_continue` will hang.
      // We should probably return a "Running..." status if it takes too long? 
      // But the user complained about "premature timeout".
      // Let's implement a very long timeout or let it hang until user cancels?
      // For an Agent, hanging 1 hour is bad.
      // Let's put 60s timeout? Or just rely on the Agent to be patient.
      // Re-reading plan: "If an execution command times out ... return specific message ... rather than error"
    });
  }


  /**
   * Terminate a GDB session
   */
  private async terminateGdbSession(sessionId: string): Promise<void> {
    if (!activeSessions.has(sessionId)) {
      throw new Error(`No active GDB session with ID: ${sessionId}`);
    }

    const session = activeSessions.get(sessionId)!;

    // Send quit command to GDB
    try {
      await this.executeGdbCommand(session, '-gdb-exit');
    } catch (error) {
      // Ignore errors from quit command, we'll force kill if needed
    }

    // Force kill the process if it's still running
    if (!session.process.killed) {
      session.process.kill();
    }

    // Close the readline interface
    session.rl.close();

    // Remove from active sessions
    activeSessions.delete(sessionId);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GDB MCP server running on stdio');
  }
}

// Create and run the server
const server = new GdbServer();
server.run().catch((error) => {
  console.error('Failed to start GDB MCP server:', error);
  process.exit(1);
});
