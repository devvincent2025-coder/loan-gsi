import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/** Exports ProductsService (toFullDto / toPortalDto helpers for the applications + portal modules). */
@Module({ providers: [ProductsService], controllers: [ProductsController], exports: [ProductsService] })
export class ProductsModule {}
