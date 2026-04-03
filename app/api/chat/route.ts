import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { createInterviewEvent } from "@/lib/google-calendar";

const anthropic = new Anthropic();

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_my_matches",
    description: "Get the user's current job matches with scores and details",
    input_schema: {
      type: "object" as const,
      properties: {
        min_score: { type: "number", description: "Minimum match score filter (0-100)" },
        limit: { type: "number", description: "Max results to return" },
      },
    },
  },
  {
    name: "get_my_applications",
    description: "Get all job applications with their current status",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["all", "applied", "manual", "interviewing", "offer", "rejected"],
          description: "Filter by status",
        },
      },
    },
  },
  {
    name: "get_application_stats",
    description: "Get summary statistics about the user's job search",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "schedule_interview",
    description: "Create a Google Calendar event for a job interview",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string" },
        job_title: { type: "string" },
        interview_date: { type: "string", description: "ISO date string" },
        notes: { type: "string" },
      },
      required: ["company", "job_title", "interview_date"],
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  get_my_matches: "Looking up your matches...",
  get_my_applications: "Checking your applications...",
  get_application_stats: "Gathering your stats...",
  schedule_interview: "Creating calendar event...",
};

const SYSTEM_PROMPT =
  "You are a job search assistant. Use your tools to fetch live data before answering. " +
  "Always call get_my_matches when asked about job matches or recommendations. " +
  "Always call get_my_applications when asked about applications or companies applied to. " +
  "Always call get_application_stats when asked for a summary or overview. " +
  "Use schedule_interview only when the user explicitly asks to schedule/add a calendar event. " +
  "Be concise — 2-4 sentences unless listing items. Never make up data; use your tools.";

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { message, history = [] } = await req.json();
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400 });
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }

      try {
        // Agentic loop — runs until Claude stops calling tools
        while (true) {
          const response = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
          });

          // Append Claude's response to the conversation
          messages.push({ role: "assistant", content: response.content });

          if (response.stop_reason === "tool_use") {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of response.content) {
              if (block.type !== "tool_use") continue;

              send({ type: "tool", label: TOOL_LABELS[block.name] ?? "Thinking..." });

              const result = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                user.id
              );

              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            }

            messages.push({ role: "user", content: toolResults });
            continue;
          }

          // Claude finished — emit the text
          for (const block of response.content) {
            if (block.type === "text") {
              send({ type: "text", chunk: block.text });
            }
          }
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI error";
        send({ type: "text", chunk: `Error: ${msg}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string
): Promise<unknown> {
  switch (name) {
    case "get_my_matches": {
      const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
      const res = await fetch(`${pythonUrl}/match-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) return { error: "Failed to fetch matches" };

      const jobs = await res.json();
      const minScore = (input.min_score as number) ?? 0;
      const limit = (input.limit as number) ?? 10;

      return (jobs as {
        title: string; company: string; claude_score: number;
        location?: string; reasons?: string[]; gaps?: string[];
      }[])
        .filter((j) => j.claude_score >= minScore)
        .slice(0, limit)
        .map((j) => ({
          title: j.title,
          company: j.company,
          score: j.claude_score,
          location: j.location,
          reasons: j.reasons,
          gaps: j.gaps,
        }));
    }

    case "get_my_applications": {
      const statusFilter = (input.status as string) ?? "all";
      const apps = await db.application.findMany({
        where: {
          user_id: userId,
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        },
        include: { job: { select: { title: true, company: true, location: true } } },
        orderBy: { applied_at: "desc" },
      });

      return apps.map((a) => ({
        title: a.job.title,
        company: a.job.company,
        location: a.job.location,
        status: a.status,
        applied_at: a.applied_at.toISOString(),
      }));
    }

    case "get_application_stats": {
      const stats = await db.application.groupBy({
        by: ["status"],
        where: { user_id: userId },
        _count: { status: true },
      });

      const result: Record<string, number> = {};
      for (const s of stats) {
        result[s.status] = s._count.status;
      }
      result.total = Object.values(result).reduce((a, b) => a + b, 0);
      return result;
    }

    case "schedule_interview": {
      const dbUser = await db.user.findUnique({
        where: { id: userId },
        select: {
          google_access_token: true,
          google_refresh_token: true,
          google_connected: true,
        },
      });

      if (!dbUser?.google_connected || !dbUser.google_access_token) {
        return {
          error:
            "Google Calendar is not connected. Ask the user to connect it in their profile settings.",
        };
      }

      const interviewDate = new Date(input.interview_date as string);
      const eventUrl = await createInterviewEvent({
        accessToken: dbUser.google_access_token,
        refreshToken: dbUser.google_refresh_token ?? "",
        jobTitle: input.job_title as string,
        company: input.company as string,
        interviewDate,
        notes: input.notes as string | undefined,
      });

      return { success: true, eventUrl };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
