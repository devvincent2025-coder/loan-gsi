import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ProductCreateInput, productCreateSchema, ProductPatchInput, productPatchSchema } from './product-schemas';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private svc: ProductsService) {}

  @Get() @RequirePermission('product:read')
  list() { return this.svc.list(); }

  @Get(':id') @RequirePermission('product:read')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post() @RequirePermission('product:create')
  create(@Body(new ZodPipe(productCreateSchema)) b: ProductCreateInput, @CurrentUser() u: AuthUser) { return this.svc.create(u, b); }

  @Patch(':id') @RequirePermission('product:update')
  patch(@Param('id') id: string, @Body(new ZodPipe(productPatchSchema)) b: ProductPatchInput, @CurrentUser() u: AuthUser) { return this.svc.patch(u, id, b); }

  @Delete(':id') @RequirePermission('product:read') @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    if (u.roleKey !== 'super_admin') throw new ForbiddenException('Only super admins can delete products');
    return this.svc.delete(u, id);
  }
}
