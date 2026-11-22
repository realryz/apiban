import { redirect } from 'next/navigation';
import { cache } from 'react';
import { hasRole } from './discord';
import { getSession } from './session';

export const requireUser = cache(async () => {
  const user = await getSession();
  if (!user) redirect('/login');
  if (!(await hasRole(user.id))) redirect('/auth/logout?error=forbidden');
  return user;
});
