import { Module } from '@nestjs/common';
import { ScorecardsController } from './scorecards.controller';
import { ScorecardService } from './scorecard.service';

@Module({ providers: [ScorecardService], controllers: [ScorecardsController], exports: [ScorecardService] })
export class ScorecardsModule {}
