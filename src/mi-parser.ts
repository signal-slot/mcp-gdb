export class MiParser {
    static parse(line: string): { type: 'result' | 'async' | 'stream' | 'prompt', data: any } | null {
        line = line.trim();

        if (line === '(gdb)') {
            return { type: 'prompt', data: null };
        }

        // Parse result record: [token]^class,data
        const resultMatch = line.match(/^(\d+)?\^(\w+)(?:,(.*))?$/);
        if (resultMatch) {
            return {
                type: 'result',
                data: {
                    token: resultMatch[1] ? parseInt(resultMatch[1]) : undefined,
                    class: resultMatch[2],
                    data: this.parseData(resultMatch[3] || '')
                }
            };
        }

        // Parse async record: [token]*class,data or +class,data or =class,data
        const asyncMatch = line.match(/^(\d+)?([*+=])(\w+)(?:,(.*))?$/);
        if (asyncMatch) {
            const types = { '*': 'exec', '+': 'status', '=': 'notify' };
            return {
                type: 'async',
                data: {
                    token: asyncMatch[1] ? parseInt(asyncMatch[1]) : undefined,
                    type: types[asyncMatch[2] as keyof typeof types],
                    class: asyncMatch[3],
                    data: this.parseData(asyncMatch[4] || '')
                }
            };
        }

        // Parse stream record: ~"..." or @"..." or &"..."
        const streamMatch = line.match(/^([~@&])"(.*)"$/);
        if (streamMatch) {
            const types = { '~': 'console', '@': 'target', '&': 'log' };
            return {
                type: 'stream',
                data: {
                    type: types[streamMatch[1] as keyof typeof types],
                    content: this.unescapeString(streamMatch[2])
                }
            };
        }

        return null;
    }

    private static parseData(dataStr: string): Record<string, any> {
        const data: Record<string, any> = {};
        let current = dataStr;

        // Simple regex-based parser for key=value pairs
        // Note: This is a simplified parser and might fail on complex nested tuples/lists
        // Ideally we would need a proper tokenizer/parser for full MI support

        // Matches: key="value" | key={...} | key=[...]
        const regex = /([a-zA-Z0-9_-]+)=("((?:[^"\\]|\\.)*)"|\{(.*?)\}|\[(.*?)\])/g;
        let match;

        while ((match = regex.exec(dataStr)) !== null) {
            const key = match[1];
            if (match[3] !== undefined) {
                // String value
                data[key] = this.unescapeString(match[3]);
            } else if (match[4] !== undefined) {
                // Object/Tuple value (recursive parse)
                data[key] = this.parseData(match[4]);
            } else if (match[5] !== undefined) {
                // List value (array)
                // This simplified parser treats lists as objects or strings for now
                // A full parser is complex due to mixed [value, value] and [key=value] formats
                data[key] = match[5];
            }
        }

        return data;
    }

    private static unescapeString(str: string): string {
        return str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }
}
