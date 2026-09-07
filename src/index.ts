import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { closeAll, PROVIDER_NAMES, track } from './router.js';

const InputSchema = z.object({
  trackingId: z.string().min(1).optional(),
  trackingIds: z.array(z.string().min(1)).optional(),
  provider: z.enum(['yuntrack', '4px']).optional(),
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
        'Track one or more parcels. The carrier is picked automatically from the ' +
        'tracking number, so the caller does not need to know it. Returns one entry ' +
        'per tracking number with the raw JSON from the carrier that answered.',
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
            description:
              'Multiple tracking numbers to look up. They are grouped by carrier and ' +
              'sent in as few upstream requests as possible.',
          },
          provider: {
            type: 'string',
            enum: PROVIDER_NAMES,
            description:
              'Optional override forcing a specific carrier. Leave this out unless ' +
              'automatic detection is known to be wrong for these numbers.',
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

  const ids = [
    ...(parsed.trackingId ? [parsed.trackingId] : []),
    ...(parsed.trackingIds ?? []),
  ];

  if (ids.length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Provide trackingId or trackingIds.' }],
    };
  }

  try {
    const results = await track(ids, { provider: parsed.provider });
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text', text: `Tracking failed: ${message}` }],
    };
  }
});

async function shutdown(): Promise<void> {
  await closeAll();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
