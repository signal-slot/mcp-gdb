[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/signal-slot-mcp-gdb-badge.png)](https://mseep.ai/app/signal-slot-mcp-gdb)

# MCP GDB Server

A Model Context Protocol (MCP) server that provides GDB debugging functionality for use with Claude or other AI assistants.

## Features

- Start and manage GDB debugging sessions
- Load programs and core dumps for analysis
- Set breakpoints, step through code, and examine memory
- View call stacks, variables, and registers
- Execute arbitrary GDB commands

## Installation

```bash
# Clone the repository
git clone https://github.com/signal-slot/mcp-gdb.git
cd mcp-gdb

# Install dependencies
npm install

# Build the project
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
