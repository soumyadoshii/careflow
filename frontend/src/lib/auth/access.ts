import type { Role } from '../api/types';
import { navigationByRole } from './session';

export const canVisitPath = (role: Role, path: string): boolean => {
  const allowedPaths = navigationByRole[role];
  return (allowedPaths ?? []).includes(path);
};

export const roleHome = (role: Role): string => role === 'Patient' ? '/' : '/';
