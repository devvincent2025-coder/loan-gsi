import { Body, Controller, Get, Global, HttpCode, Module, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentCustomer, PortalAuth } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { PortalUser } from '../portal/portal-session.service';
import { consentGrantSchema, OnboardingService, profileSchema } from './onboarding.service';

@Controller('portal')
@PortalAuth()
class OnboardingController {
  constructor(private svc: OnboardingService) {}

  @Get('onboarding') state(@CurrentCustomer() c: PortalUser) { return this.svc.state(c.id); }

  @Put('profile') profile(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(profileSchema)) b: z.infer<typeof profileSchema>) { return this.svc.updateProfile(c.id, b); }

  @Get('consents') consents(@CurrentCustomer() c: PortalUser) { return this.svc.consents(c.id); }

  @Post('consents') @HttpCode(200)
  grant(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(consentGrantSchema)) b: z.infer<typeof consentGrantSchema>) { return this.svc.grant(c.id, b); }

  @Post('consents/:purpose/revoke') @HttpCode(200)
  revoke(@CurrentCustomer() c: PortalUser, @Param('purpose') purpose: string) { return this.svc.revoke(c.id, purpose); }
}

@Global()
@Module({ controllers: [OnboardingController], providers: [OnboardingService], exports: [OnboardingService] })
export class OnboardingModule {}
