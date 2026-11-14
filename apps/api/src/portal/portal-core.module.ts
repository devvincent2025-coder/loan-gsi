import { Global, Module } from '@nestjs/common';
import { PortalSessionService } from './portal-session.service';

@Global()
@Module({ providers: [PortalSessionService], exports: [PortalSessionService] })
export class PortalCoreModule {}
