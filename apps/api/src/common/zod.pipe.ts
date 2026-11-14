import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodTypeAny } from 'zod';

/** Usage: `@Body(new ZodPipe(schema)) body: z.infer<typeof schema>` or `@Query(new ZodPipe(schema))`. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): ReturnType<T['parse']> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      const errors: Record<string, string[]> = {};
      for (const i of r.error.issues) {
        const k = i.path.join('.') || '_';
        (errors[k] ??= []).push(i.message);
      }
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', code: 'VALIDATION_FAILED', errors });
    }
    return r.data;
  }
}
