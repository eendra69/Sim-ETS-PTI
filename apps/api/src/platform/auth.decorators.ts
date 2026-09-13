import { SetMetadata } from '@nestjs/common';
import { ApplicationRole } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: ApplicationRole[]) => SetMetadata(ROLES_KEY, roles);
