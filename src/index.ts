import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { closeBrowser, trackParcel, trackParcels } from './tracker.js';

const InputSchema = z.object({
  trackingId: z.string().min(1).optional(),
  trackingIds: z.array(z.string().min(1)).optional(),
});

const server = new Server(
  { name: 'mcp-parceltrack', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'track_parcel',
      description:
        'Track one or more parcels via YunTrack. Returns the raw JSON from the YunTrack Query API.',
      inputSchema: {
        type: 'object',
        properties: {
          trackingId: {
            type: 'string',
            description: 'A single tracking number to look up.',
          },
          trackingIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple tracking numbers to look up in parallel (max 3 at a time).',
          },
        },
        anyOf: [
          { required: ['trackingId'] },
          { required: ['trackingIds'] },
        ],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'track_parcel') {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
    };
  }

  let parsed: z.infer<typeof InputSchema>;
  try {
    parsed = InputSchema.parse(req.params.arguments);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }

  if (!parsed.trackingId && (!parsed.trackingIds || parsed.trackingIds.length === 0)) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Provide trackingId or trackingIds.' }],
    };
  }

  try {
    if (parsed.trackingIds && parsed.trackingIds.length > 0) {
      const results = await trackParcels(parsed.trackingIds);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const data = await trackParcel(parsed.trackingId!);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text', text: `Tracking failed: ${message}` }],
    };
  }
});

async function shutdown(): Promise<void> {
  await closeBrowser();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
