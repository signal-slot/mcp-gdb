# MCP GDB Server

[![npm version](https://img.shields.io/npm/v/mcp-gdb.svg)](https://www.npmjs.com/package/mcp-gdb)
[![license](https://img.shields.io/npm/l/mcp-gdb.svg)](https://github.com/signal-slot/mcp-gdb/blob/main/LICENSE)

A Model Context Protocol (MCP) server that provides GDB debugging functionality for use with Claude or other AI assistants.

## Features

- Start and manage GDB debugging sessions
- Load programs and core dumps for analysis
- Set breakpoints, step through code, and examine memory
- View call stacks, variables, and registers
- Execute arbitrary GDB commands

## Installation

### Option 1: Install from NPM

```bash
npm install mcp-gdb
```

You can use the package in your Node.js project:

```javascript
import { startGdbServer } from 'mcp-gdb';

// Start the server programmatically
startGdbServer();
```

### Option 2: Install from Source

```bash
# Clone the repository
git clone https://github.com/signal-slot/mcp-gdb.git
cd mcp-gdb
npm install
npm run build
```

## Usage

### Using with Claude or other MCP-enabled assistants

1. Configure the MCP settings in the Claude desktop app or browser extension to include this server:

```json
{
  "mcpServers": {
    "gdb": {
      "command": "node", 
      "args": ["/path/to/mcp-gdb/build/index.js"],
      "disabled": false
    }
  }
}
```

If you installed via NPM, you can reference the package in node_modules:

```json
{
  "mcpServers": {
    "gdb": {
      "command": "node",
      "args": ["node_modules/mcp-gdb/build/index.js"],
      "disabled": false
    }
  }
}
```

2. Restart Claude or refresh the page.

3. Now you can use the GDB tools in your conversations with Claude.

### Example Commands

Here are some examples of using the GDB MCP server through Claude:

#### Starting a GDB session
```
Use gdb_start to start a new debugging session
```

#### Loading a program
```
Use gdb_load to load /path/to/my/program with the sessionId that was returned from gdb_start
```

#### Setting a breakpoint
```
Use gdb_set_breakpoint to set a breakpoint at main in the active GDB session
```

#### Running the program
```
Use gdb_continue to start execution
```

#### Examining variables
```
Use gdb_print to evaluate the expression "my_variable" in the current context
```

#### Getting a backtrace
```
Use gdb_backtrace to see the current call stack
```

#### Terminating the session
```
Use gdb_terminate to end the debugging session
```

## NPM Package Information

The `mcp-gdb` package is available on [npm](https://www.npmjs.com/package/mcp-gdb) and provides all the functionality needed to integrate GDB debugging with MCP-enabled AI assistants.

- **Current Version**: 0.1.0
- **Main**: build/index.js
- **Type**: ESM module
- **License**: MIT
- **Keywords**: gdb, debug, mcp
- **Repository**: [GitHub](https://github.com/signal-slot/mcp-gdb)

## Supported GDB Commands

- `gdb_start`: Start a new GDB session
- `gdb_load`: Load a program into GDB
- `gdb_command`: Execute an arbitrary GDB command
- `gdb_terminate`: Terminate a GDB session
- `gdb_list_sessions`: List all active GDB sessions
- `gdb_attach`: Attach to a running process
- `gdb_load_core`: Load a core dump file
- `gdb_set_breakpoint`: Set a breakpoint
- `gdb_continue`: Continue program execution
- `gdb_step`: Step program execution
- `gdb_next`: Step over function calls
- `gdb_finish`: Execute until the current function returns
- `gdb_backtrace`: Show call stack
- `gdb_print`: Print value of expression
- `gdb_examine`: Examine memory
- `gdb_info_registers`: Display registers

## License

MIT
