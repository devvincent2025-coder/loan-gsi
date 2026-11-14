import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { LlmGatewayService } from '../llm-gateway/llm-gateway.module';
import { TokenizationService } from '../pii-vault/pii-vault.module';
import { AuditService } from '../audit/audit.service';
import { ExecutiveToolsService } from './executive-tools.service';

export interface ChatResult {
  sessionId: string;
  response: string;
  toolCallsUsed: string[];
  messageId: string;
}

@Injectable()
export class ExecChatService {
  private readonly log = new Logger('ExecChat');

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmGatewayService,
    private readonly tokenization: TokenizationService,
    private readonly audit: AuditService,
    private readonly tools: ExecutiveToolsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Process a chat message from an executive user. */
  async chat(
    sessionId: string | null,
    userId: string,
    message: string,
    branchScope: string | null,
  ): Promise<ChatResult> {
    // 1. Upsert session
    let session: { id: string; title: string | null };
    if (sessionId) {
      const existing = await this.prisma.execChatSession.findUnique({ where: { id: sessionId } });
      if (!existing || existing.userId !== userId) {
        throw new NotFoundException('Chat session not found');
      }
      session = existing;
    } else {
      session = await this.prisma.execChatSession.create({
        data: { userId, title: null },
      });
    }

    // 2. Save user message
    await this.prisma.execChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: message,
      },
    });

    // 3. Load last 10 messages for context
    const history = await this.prisma.execChatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    history.reverse();

    // 4. Build tool definitions
    const toolDefs = this.tools.getToolDefinitions();

    // 5. Build prompts
    const systemPrompt = this.buildSystemPrompt(toolDefs);
    const userPromptParts = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
    const userPrompt = `${userPromptParts}\n\nUser: ${message}\n\nRespond as the executive intelligence assistant. Use the tools to fetch data when needed.`;

    const toolCallsUsed: string[] = [];
    let finalResponse = '';

    if (!this.env.LLM_ENABLED) {
      // Mock response
      finalResponse = `[LLM_DISABLED] I received your question: "${message}". Please enable LLM to get intelligent responses.`;
    } else {
      // Agentic tool-calling loop
      const maxLoops = this.env.LLM_MAX_TOOL_LOOPS;
      let loopCount = 0;
      let currentUserPrompt = userPrompt;

      while (loopCount < maxLoops) {
        loopCount++;

        let llmText = '';
        try {
          llmText = await this.llm.complete(
            'executive.chat',
            systemPrompt,
            currentUserPrompt,
            { userId },
          );
        } catch (err) {
          this.log.error(`LLM chat error: ${(err as Error).message}`);
          finalResponse = 'I encountered an error processing your request. Please try again.';
          break;
        }

        // Check for tool call requests in the response
        const toolCallMatch = llmText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
        if (!toolCallMatch) {
          finalResponse = llmText;
          break;
        }

        // Parse and execute tool call
        let toolResult: unknown;
        let toolName = '';
        try {
          const parsed = JSON.parse(toolCallMatch[1]) as { name: string; parameters: Record<string, unknown> };
          toolName = parsed.name;
          toolCallsUsed.push(toolName);

          toolResult = await this.tools.callTool(toolName, parsed.parameters ?? {}, branchScope);

          await this.audit.record({
            action: 'executive.chat_tool_call',
            resourceType: 'ExecChatSession',
            resourceId: session.id,
            actorId: userId,
            after: { tool: toolName, sessionId: session.id },
          });
        } catch (err) {
          toolResult = { error: (err as Error).message };
          this.log.warn(`Tool call failed: ${toolName} — ${(err as Error).message}`);
        }

        // Feed tool result back into the next prompt iteration
        currentUserPrompt = `${currentUserPrompt}\n\nAssistant (tool call: ${toolName}): ${JSON.stringify(toolResult)}\n\nUser: Please continue with the information from the tool result above.`;
      }

      if (!finalResponse) {
        finalResponse = 'I was unable to complete the analysis within the allowed number of steps. Please ask a more specific question.';
      }
    }

    // 6. Save assistant message
    const assistantMsg = await this.prisma.execChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: finalResponse,
        toolCalls: toolCallsUsed.length > 0 ? (toolCallsUsed as never) : undefined,
      },
    });

    // Update session title from first user message if not set
    if (!session.title) {
      const titlePreview = message.slice(0, 80);
      await this.prisma.execChatSession.update({
        where: { id: session.id },
        data: { title: titlePreview },
      });
    }

    return {
      sessionId: session.id,
      response: finalResponse,
      toolCallsUsed,
      messageId: assistantMsg.id,
    };
  }

  /** Toggle pinned state of a message. */
  async pinMessage(messageId: string, userId: string): Promise<{ pinned: boolean }> {
    const msg = await this.prisma.execChatMessage.findUnique({
      where: { id: messageId },
      include: { session: { select: { userId: true } } },
    });
    if (!msg || msg.session.userId !== userId) {
      throw new NotFoundException('Message not found');
    }
    const updated = await this.prisma.execChatMessage.update({
      where: { id: messageId },
      data: { pinned: !msg.pinned },
    });
    return { pinned: updated.pinned };
  }

  /** List chat sessions for a user. */
  async listSessions(userId: string): Promise<Record<string, unknown>[]> {
    const sessions = await this.prisma.execChatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      lastMessage: s.messages[0]
        ? {
            preview: s.messages[0].content.slice(0, 100),
            role: s.messages[0].role,
            at: s.messages[0].createdAt.toISOString(),
          }
        : null,
    }));
  }

  /** Get all messages in a session. */
  async getSession(sessionId: string, userId: string): Promise<Record<string, unknown>> {
    const session = await this.prisma.execChatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session || session.userId !== userId) {
      throw new NotFoundException('Chat session not found');
    }

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        pinned: m.pinned,
        toolCalls: m.toolCalls,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  private buildSystemPrompt(toolDefs: ReturnType<ExecutiveToolsService['getToolDefinitions']>): string {
    return `You are the Damez Executive Intelligence Assistant — an AI advisor for the CEO and senior leadership of a Nigerian microfinance bank.

You have access to real-time portfolio data through the following tools. To call a tool, respond with:
<tool_call>{"name": "<tool_name>", "parameters": { ... }}</tool_call>

Available tools:
${toolDefs.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

RULES:
1. Always use tools to fetch current data before answering questions about metrics.
2. Cite specific numbers in your responses.
3. Convert kobo to naira (divide by 100) before presenting to the user.
4. Flag anomalies and risk signals prominently.
5. Keep responses concise and action-oriented.
6. Never fabricate data — only use what tools return.
7. All portfolio data is for a Nigerian lender; use ₦ for currency.`;
  }
}
