# Using the MCP GDB Server: Example Usage

This guide demonstrates how to use the MCP GDB server to debug the included `crash.c` example.

## Compiling the Example

First, compile the example with debug symbols:

```bash
cd examples
gcc -g crash.c -o crash
```

## Debugging Session Example

Here's a step-by-step guide showing how to debug the crash.c program using the MCP GDB server through Claude.

### 1. Start a GDB Session

Ask Claude to start a new GDB session:

```
I need to debug a program that's crashing. Can you start a new GDB session for me?
```

Claude will use the `gdb_start` tool:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_start</tool_name>
<arguments>
{}
</arguments>
</use_mcp_tool>
```

Claude will receive a response with a session ID (e.g., "1616161616161").

### 2. Load the Program

Now, ask Claude to load the program:

```
Can you load the crash executable I compiled in the examples directory?
```

Claude will use the `gdb_load` tool:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_load</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "program": "/path/to/mcp-gdb/examples/crash"
}
</arguments>
</use_mcp_tool>
```

### 3. Set Breakpoints

Set a breakpoint at the main function:

```
Please set a breakpoint at the main function.
```

Claude will use `gdb_set_breakpoint`:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_set_breakpoint</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "location": "main"
}
</arguments>
</use_mcp_tool>
```

Let's also set a breakpoint at the function that might crash:

```
Can you also set a breakpoint at function_with_args?
```

Claude will set another breakpoint:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_set_breakpoint</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "location": "function_with_args"
}
</arguments>
</use_mcp_tool>
```

### 4. Start the Program

Start the program with an argument that will cause a crash (any number > 10):

```
Please run the program with an argument of 15, which should trigger the crash.
```

Claude will use `gdb_command` to set the arguments and then run the program:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_command</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "command": "set args 15"
}
</arguments>
</use_mcp_tool>
```

Then Claude will start the program:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_continue</tool_name>
<arguments>
{
  "sessionId": "1616161616161"
}
</arguments>
</use_mcp_tool>
```

The program will hit the first breakpoint at `main`.

### 5. Step Through the Program

Ask Claude to step through the execution:

```
Please step through the program execution so we can see what's happening.
```

Claude will use `gdb_next` to step through the code:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_next</tool_name>
<arguments>
{
  "sessionId": "1616161616161"
}
</arguments>
</use_mcp_tool>
```

Repeat this command to step through the program.

### 6. Examine Variables

At any point, you can ask Claude to print the value of variables:

```
What is the value of the 'number' variable?
```

Claude will use `gdb_print`:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_print</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "expression": "number"
}
</arguments>
</use_mcp_tool>
```

### 7. Continue to Crash

Continue execution until the program crashes:

```
Please continue execution until we hit the crash.
```

Claude will use `gdb_continue`:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_continue</tool_name>
<arguments>
{
  "sessionId": "1616161616161"
}
</arguments>
</use_mcp_tool>
```

The program will hit the second breakpoint and then crash when trying to dereference a NULL pointer.

### 8. Analyze the Crash

When the program crashes, examine the backtrace to see where it occurred:

```
Can you show me the backtrace of the crash?
```

Claude will use `gdb_backtrace`:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_backtrace</tool_name>
<arguments>
{
  "sessionId": "1616161616161"
}
</arguments>
</use_mcp_tool>
```

The backtrace will show that the crash occurred in `function_that_crashes` when trying to dereference a NULL pointer.

### 9. Terminate the Session

When you're done debugging, terminate the GDB session:

```
Please terminate the GDB session.
```

Claude will use `gdb_terminate`:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_terminate</tool_name>
<arguments>
{
  "sessionId": "1616161616161"
}
</arguments>
</use_mcp_tool>
```

## Using with Core Dumps

If the program has already crashed and generated a core dump, you can load it for analysis:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_start</tool_name>
<arguments>
{}
</arguments>
</use_mcp_tool>
```

Then load the program and core dump:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_load_core</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "program": "/path/to/mcp-gdb/examples/crash",
  "corePath": "/path/to/core.dump"
}
</arguments>
</use_mcp_tool>
```

Then you can analyze the crash just as if you had caught it in real-time.

## VS Code Integration for Source Code Viewing

The MCP GDB server now supports viewing source code in VS Code with the `gdb_list_source` tool:

### Viewing Source Code 

Ask Claude to show you the source code:

```
Can you show me the source code at our current location?
```

Claude will use `gdb_list_source`:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_list_source</tool_name>
<arguments>
{
  "sessionId": "1616161616161"
}
</arguments>
</use_mcp_tool>
```

You can also specify a location:

```
Can you show me the source code for the function_that_crashes function?
```

Claude will use:

```
<use_mcp_tool>
<server_name>gdb</server_name>
<tool_name>gdb_list_source</tool_name>
<arguments>
{
  "sessionId": "1616161616161",
  "location": "function_that_crashes"
}
</arguments>
</use_mcp_tool>
```

### Opening Source Code in VS Code

The `gdb_list_source` command returns a VS Code URI that can be clicked to open the file directly at the specified line:

```
Claude's response will include a VS Code URI in this format:

vscode://file/path/to/source/file.c:25

Simply click on this URI in Claude's response, and VS Code will open the file
at the specified line.
