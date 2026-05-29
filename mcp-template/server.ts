import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';

const SERVER_NAME = 'replace-with-server-name';  // e.g. 'keyword-tracker'
const SERVER_VERSION = '1.0.0';

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

// ── STEP 1: Declare all tools this server exposes ─────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'tool_name_here',
      description: 'What this tool does — be specific for Claude',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'number', description: 'Site ID from config (1, 2, 3...)' },
          // add more params here
        },
        required: ['site_id']
      }
    }
    // Add more tools here
  ]
}));

// ── STEP 2: Handle tool calls from Claude ─────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case 'tool_name_here': {
        const result = await yourApiCall(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
      isError: true
    };
  }
});

// ── STEP 3: Start SSE server ──────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  // Handle incoming messages
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok', server: SERVER_NAME }));

export default app;