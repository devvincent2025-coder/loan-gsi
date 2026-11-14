import { Module } from '@nestjs/common';
import { StaffDirectoryController } from './staff-directory.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ providers: [UsersService], controllers: [UsersController, StaffDirectoryController] })
export class UsersModule {}
