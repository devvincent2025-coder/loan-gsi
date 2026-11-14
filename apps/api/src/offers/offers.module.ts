import { Module } from '@nestjs/common';
import { PortalOffersController, StaffOffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({ controllers: [StaffOffersController, PortalOffersController], providers: [OffersService], exports: [OffersService] })
export class OffersModule {}
