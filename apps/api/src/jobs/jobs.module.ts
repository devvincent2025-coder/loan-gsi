import { Module } from '@nestjs/common';
import { ExecutiveModule } from '../executive/executive.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [ExecutiveModule],
  providers: [JobsService],
})
export class JobsModule {}
