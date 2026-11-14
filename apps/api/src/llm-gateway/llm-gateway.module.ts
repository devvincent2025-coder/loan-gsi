import {
  Inject,
  Injectable,
  Logger,
  Module,
} from '@nestjs/common';
import { APP_ENV, AppEnv, ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PiiVaultModule, TokenizationService } from '../pii-vault/pii-vault.module';

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface ILlmAdapter {
  complete(
    system: string,
    user: string,
    model: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }>;
}

// ─── MockLlmAdapter ───────────────────────────────────────────────────────────

const MOCK_RESPONSES: Record<string, string> = {
  'behaviour.summary': 'Customer shows consistent repayment behaviour with moderate risk profile.',
  'behaviour.segment': 'RELIABLE',
};

@Injectable()
export class MockLlmAdapter implements ILlmAdapter {
  async complete(
    _system: string,
    _user: string,
    model: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    // feature is baked into _user by convention; look up by known keys
    const matchedKey = Object.keys(MOCK_RESPONSES).find((k) => _user.includes(k) || _system.includes(k));
    const text = matchedKey
      ? MOCK_RESPONSES[matchedKey]
      : `Mock LLM response for feature: ${model}`;
    return { text, promptTokens: 100, completionTokens: 50 };
  }
}

// ─── LiveLlmAdapter ───────────────────────────────────────────────────────────

@Injectable()
export class LiveLlmAdapter implements ILlmAdapter {
  private readonly log = new Logger('LiveLlmAdapter');

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  // TODO: Replace dynamic import with DI once LlmGatewayModule wires the real SDK
  async complete(
    system: string,
    user: string,
    model: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for live LLM provider');
    }

    // require() keeps @anthropic-ai/sdk out of the top-level module graph (arch rule).
    // TODO: install @anthropic-ai/sdk; add timeout and monthly budget tracking.
    const Sdk = require('@anthropic-ai/sdk');
    const client = new (Sdk.default ?? Sdk)({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await (client as { messages: { create: (...a: unknown[]) => Promise<unknown> } }).messages.create({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const r = response as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return { text, promptTokens: r.usage.input_tokens, completionTokens: r.usage.output_tokens };
  }
}

// ─── LLM_ADAPTER injection token ─────────────────────────────────────────────

export const LLM_ADAPTER = 'LLM_ADAPTER';

// ─── LlmGatewayService ────────────────────────────────────────────────────────

// Claude Haiku approximate pricing ($/token). Adjust when model changes.
const COST_PER_INPUT_TOKEN = 0.25 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 1.25 / 1_000_000;

@Injectable()
export class LlmGatewayService {
  private readonly log = new Logger('LlmGateway');

  constructor(
    @Inject(LLM_ADAPTER) private readonly adapter: ILlmAdapter,
    private readonly tokenization: TokenizationService,
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /**
   * The ONLY code path for LLM inference. Guards PII, logs usage, and returns the response.
   *
   * @param opts.userId  - Staff user ID initiating the request (for audit logging).
   * @param opts.subjectId - Customer/subject ID whose data is being processed. When provided,
   *   a consent check should be performed before calling this method (full ConsentService wiring
   *   is deferred to avoid circular-dependency risk; callers are responsible for the check in
   *   the meantime). A warning is logged when subjectId is supplied so it is traceable in audit.
   */
  async complete(
    feature: string,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; subjectId?: string },
  ): Promise<string> {
    const userId = opts?.userId;
    const subjectId = opts?.subjectId;

    if (!this.env.LLM_ENABLED) {
      return `[LLM_DISABLED: ${feature}]`;
    }

    if (subjectId) {
      // TODO(phase-5): wire ConsentService here once LlmGatewayModule can import ConsentModule
      // without circular deps. Until then, log that consent was assumed by the caller.
      this.log.warn({ feature, userId, subjectId }, 'LLM inference for subject — caller must verify LLM_PROCESSING consent before calling');
    }

    // Block raw PII in both prompts before they leave the API boundary
    await this.tokenization.blockIfPii(userPrompt, feature, userId);
    await this.tokenization.blockIfPii(systemPrompt, feature, userId);

    const model = this.env.ANTHROPIC_MODEL;
    const start = Date.now();

    const { text, promptTokens, completionTokens } = await this.adapter.complete(
      systemPrompt,
      userPrompt,
      model,
    );

    const latencyMs = Date.now() - start;
    const costMicroUsd = Math.round(
      (promptTokens * COST_PER_INPUT_TOKEN + completionTokens * COST_PER_OUTPUT_TOKEN) * 1_000_000,
    );

    // Scan response for PII — log a warning but do NOT block (response came from LLM, not user)
    const responsePiiTypes = this.tokenization.scanForRawPii(text);
    if (responsePiiTypes.length > 0) {
      this.log.warn({ feature, userId, subjectId, types: responsePiiTypes }, 'LLM response contains apparent PII — review model output');
    }

    await this.prisma.llmInferenceLog.create({
      data: {
        feature,
        userId: userId ?? null,
        model,
        promptTokens,
        completionTokens,
        costMicroUsd,
        latencyMs,
      },
    });

    return text;
  }
}

// ─── LlmGatewayModule ─────────────────────────────────────────────────────────

@Module({
  imports: [PiiVaultModule, PrismaModule, ConfigModule],
  providers: [
    MockLlmAdapter,
    LiveLlmAdapter,
    {
      provide: LLM_ADAPTER,
      inject: [APP_ENV, MockLlmAdapter, LiveLlmAdapter],
      useFactory: (env: AppEnv, mock: MockLlmAdapter, live: LiveLlmAdapter): ILlmAdapter =>
        env.LLM_PROVIDER === 'anthropic' ? live : mock,
    },
    LlmGatewayService,
  ],
  exports: [LlmGatewayService],
})
export class LlmGatewayModule {}
