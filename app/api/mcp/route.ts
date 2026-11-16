/* The Claude connector (MCP) endpoint: builds draft projects from page links in the synced store.
   Connector URL: https://<your-domain>/api/mcp?x-vercel-protection-bypass=<bypass>&key=<MCP_TOKEN>.
   Tool results are small text only (no image bytes; no rendering on the server). Server only. */
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { captureScreenshot } from '@/lib/capture/server';
import { mcpAccess } from '@/lib/mcp/auth';
import { CANVASES } from '@/lib/mcp/draft';
import { draftTools } from '@/lib/mcp/tools';
import { PROJECT_ID_RE } from '@/lib/projects/model';
import { projectStore } from '@/lib/projects/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 300 s is the Hobby plan's maximum.
export const maxDuration = 300;

const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });

async function withStore(fn: (tools: ReturnType<typeof draftTools>) => Promise<string>) {
  const store = await projectStore();
  if (!store) return textResult('Projects sync is off on this deployment, so there is nowhere to put a draft.');
  const tools = draftTools({ store, capture: (i) => captureScreenshot(i), now: Date.now });
  return textResult(await fn(tools));
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'list_options',
      {
        description: 'List available canvas sizes, layout presets, and looks for Layout Stage draft projects.',
        inputSchema: z.object({}),
      },
      async () => {
        const tools = draftTools({ store: null as never, capture: async () => { throw new Error('unused'); }, now: Date.now });
        return textResult(tools.listOptions());
      },
    );

    server.registerTool(
      'list_projects',
      {
        description: 'List up to 50 draft projects in Layout Stage, newest first.',
        inputSchema: z.object({}),
      },
      async () => withStore((t) => t.listProjects()),
    );

    server.registerTool(
      'get_project',
      {
        description: 'Inspect a Layout Stage draft project (canvas size, layouts, pages, Media, background).',
        inputSchema: z.object({
          project: z.string().regex(PROJECT_ID_RE),
        }),
      },
      async ({ project }) => withStore((t) => t.getProject(project)),
    );

    server.registerTool(
      'create_project',
      {
        description: 'Create a new draft project in Layout Stage (appears in Projects for the owner to open in the editor).',
        inputSchema: z.object({
          name: z.string().min(1).max(120),
          canvas: z.enum(CANVASES).optional(),
          look: z.string().max(80).optional(),
        }),
      },
      async ({ name, canvas, look }) => withStore((t) => t.createProject({ name, canvas, look })),
    );

    server.registerTool(
      'add_page',
      {
        description: 'Capture a public web page URL and place it into a Layout Stage draft project.',
        inputSchema: z.object({
          project: z.string().regex(PROJECT_ID_RE),
          url: z.string().max(2048),
          device: z.enum(['desktop', 'phone']).optional(),
          full_page: z.boolean().optional(),
        }),
      },
      async ({ project, url, device, full_page }) =>
        withStore((t) => t.addPage({ project, url, device, fullPage: full_page })),
    );

    server.registerTool(
      'set_layout',
      {
        description: 'Change the number of layouts, layout preset, canvas size, or look of a Layout Stage draft project.',
        inputSchema: z.object({
          project: z.string().regex(PROJECT_ID_RE),
          layouts: z.number().int().min(1).max(3).optional(),
          layout: z.string().max(80).optional(),
          canvas: z.enum(CANVASES).optional(),
          look: z.string().max(80).optional(),
        }),
      },
      async ({ project, layouts, layout, canvas, look }) =>
        withStore((t) => t.setLayout({ project, layouts, layout, canvas, look })),
    );
  },
  { serverInfo: { name: 'layout-stage', version: '0.1.0' } },
);

async function handle(request: Request): Promise<Response> {
  const access = mcpAccess(request);
  if (access === 'off') {
    return new Response('The Claude connector is off here.', {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (access === 'denied') {
    return new Response('Unauthorized.', {
      status: 401,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return mcpHandler(request);
}

export { handle as GET, handle as POST };
